"""GitHub requests a deployment; the Mac pulls only a tested main revision.

No Actions runner, inbound port, or server credentials in GitHub are required.
"""

import fcntl
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPOSITORY = 'Yelihi/resume-agent'
ENVIRONMENT = 'production-backend'
WORKFLOW = '.github/workflows/ci.yml'


def api(path, payload=None):
    command = ['gh', 'api', f'repos/{REPOSITORY}/{path}']
    if payload is not None:
        command += ['--method', 'POST', '--input', '-']
    return json.loads(subprocess.check_output(command, input=json.dumps(payload) if payload is not None else None, text=True))


def status(deployment, state, description):
    api(f'deployments/{deployment["id"]}/statuses', {
        'state': state, 'description': description,
        'log_url': f'https://github.com/{REPOSITORY}/actions/runs/{deployment["payload"]["run_id"]}',
        'auto_inactive': False,
    })


def request():
    revision = os.environ['GITHUB_SHA']
    if (os.environ['GITHUB_REPOSITORY'] != REPOSITORY
            or os.environ['GITHUB_REF'] != 'refs/heads/main'
            or api('commits/main')['sha'] != revision):
        raise ValueError('Only the current main revision can request deployment')
    deployment = api('deployments', {
        'ref': revision, 'environment': ENVIRONMENT, 'auto_merge': False,
        'required_contexts': [], 'production_environment': True,
        'payload': {'run_id': int(os.environ['GITHUB_RUN_ID']), 'run_attempt': int(os.environ['GITHUB_RUN_ATTEMPT'])},
        'description': 'Back up and deploy the CI-tested native backend',
    })
    print(f'Deployment {deployment["id"]}: waiting for the Mac', flush=True)
    for _ in range(100):
        states = api(f'deployments/{deployment["id"]}/statuses?per_page=1')
        if states:
            state = states[0]['state']
            if state == 'success':
                print('Backup, native release and health check succeeded')
                return
            if state in ('failure', 'error', 'inactive'):
                raise RuntimeError('Mac deployment failed; inspect its deployment log')
        time.sleep(10)
    raise TimeoutError('Mac did not finish in time; inspect its status before retrying')


def eligible(deployment, run, jobs, revision):
    payload = deployment.get('payload') or {}
    return (
        deployment.get('environment') == ENVIRONMENT
        and deployment.get('sha') == revision
        and re.fullmatch(r'[0-9a-f]{40}', revision) is not None
        and run.get('repository', {}).get('full_name') == REPOSITORY
        and run.get('head_repository', {}).get('full_name') == REPOSITORY
        and run.get('path') == WORKFLOW
        and run.get('head_branch') == 'main'
        and run.get('head_sha') == revision
        and run.get('event') in ('push', 'workflow_dispatch')
        and run.get('status') == 'in_progress'
        and run.get('id') == payload.get('run_id')
        and run.get('run_attempt') == payload.get('run_attempt')
        and any(job['name'] == 'checks' and job['conclusion'] == 'success' for job in jobs)
        and any(job['name'] == 'backend' and job['status'] == 'in_progress' for job in jobs)
    )


def poll(state_directory):
    directory = Path(state_directory).resolve(strict=True)
    if directory.stat().st_uid != os.getuid() or directory.stat().st_mode & 0o077:
        raise ValueError('Deployment directory must be owner-only')
    # ponytail: one Mac and one deployment; a local lock serializes timer/manual runs.
    with (directory / 'poll.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        deployments = api(f'deployments?environment={ENVIRONMENT}&per_page=1')
        if not deployments:
            return
        deployment = deployments[0]
        states = api(f'deployments/{deployment["id"]}/statuses?per_page=1')
        # Interrupted or failed deployments need inspection; never automatically retry a migration.
        if states and states[0]['state'] != 'queued':
            return
        payload = deployment.get('payload') or {}
        run_id = payload.get('run_id')
        if not isinstance(run_id, int):
            return
        run = api(f'actions/runs/{run_id}')
        jobs = api(f'actions/runs/{run_id}/jobs?per_page=100')['jobs']
        revision = api('commits/main')['sha']
        if not eligible(deployment, run, jobs, revision):
            return
        status(deployment, 'in_progress', 'Mac is preparing the tested release and encrypted backup')
        try:
            checkout = directory / 'checkout'
            if not checkout.exists():
                subprocess.run(['git', 'clone', f'https://github.com/{REPOSITORY}.git', str(checkout)], check=True)
            if subprocess.check_output(['git', '-C', str(checkout), 'status', '--porcelain', '--untracked-files=no'], text=True).strip():
                raise ValueError('Deployment checkout has local changes')
            subprocess.run(['git', '-C', str(checkout), 'fetch', f'https://github.com/{REPOSITORY}.git', 'main'], check=True)
            fetched = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'FETCH_HEAD'], text=True).strip()
            if fetched != revision or api('commits/main')['sha'] != revision:
                raise ValueError('Main changed while preparing the deployment')
            subprocess.run(['git', '-C', str(checkout), 'checkout', '--detach', revision], check=True)
            private = Path.home() / '.config/resume-agent'
            subprocess.run([
                '/bin/sh', str(checkout / 'deploy/run-release.sh'),
                str(private / 'server.env'), str(private / 'backup.env'),
                '/Volumes/Storage2TB/server/resume-agent/release', revision,
            ], check=True)
            status(deployment, 'success', 'Encrypted backup, native release and health check succeeded')
            print(f'Deployed {revision}', flush=True)
        except BaseException:
            status(deployment, 'failure', 'Inspect Mac deployment log and backup before retrying')
            raise


if __name__ == '__main__':
    os.umask(0o077)
    try:
        if sys.argv[1:] == ['request']:
            request()
        elif len(sys.argv) == 3 and sys.argv[1] == 'poll':
            poll(sys.argv[2])
        else:
            raise ValueError('Usage: github-deploy.py request | poll PRIVATE_STATE_DIRECTORY')
    except Exception as error:
        print(f'Deployment failed ({type(error).__name__}); inspect GitHub and local deployment state.', file=sys.stderr)
        sys.exit(1)

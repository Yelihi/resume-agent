"""Deploy a tested native macOS release. Existing installation and backup are mandatory."""

import fcntl
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def switch(current, target):
    temporary = current.with_name('.current-next')
    # Never replace an unexpected file left by another operator/process.
    temporary.symlink_to(target)
    os.replace(temporary, current)


def wait_health(ready):
    for _ in range(30):
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:8000/health', timeout=1) as response:
                healthy = response.status == 200 and json.load(response) == {'status': 'ok'}
        except (OSError, ValueError):
            healthy = False
        if healthy == ready:
            return
        time.sleep(1)
    raise RuntimeError('Backend health did not reach the required state')


def service_commands(current, server_env, backup_env):
    """Accept only the existing shell jobs or the installed, fixed-purpose Mac app."""
    home = Path.home()
    launcher = home / 'Applications/Resume Agent Service.app/Contents/MacOS/ResumeAgentService'
    commands = {}
    for job, environment in (('app', server_env), ('backup', backup_env)):
        plist = home / f'Library/LaunchAgents/com.resume-agent.{job}.plist'
        settings = plistlib.loads(plist.read_bytes())
        command = settings.get('ProgramArguments')
        shell = ['/bin/sh', str(current / f'deploy/run-{job}.sh'), environment]
        wrapped = [str(launcher), job]
        if settings.get('Label') != f'com.resume-agent.{job}':
            raise ValueError('Unexpected LaunchAgent label')
        if command != shell:
            if (command != wrapped or not launcher.is_file()
                    or current != Path('/Volumes/Storage2TB/server/resume-agent/release/current')
                    or environment != str(home / '.config/resume-agent' / ('server.env' if job == 'app' else 'backup.env'))):
                raise ValueError('LaunchAgent must use the configured current release and environment')
        commands[job] = command
    return commands


def activate(current, release, plist, server_env, backup_env, backup_command=None):
    domain = f'gui/{os.getuid()}'
    service = f'{domain}/com.resume-agent.app'
    previous = current.resolve(strict=True)
    run('launchctl', 'print', service, stdout=subprocess.DEVNULL)
    run('launchctl', 'bootout', service)
    try:
        wait_health(False)
        # Use the old code/schema for the pre-deployment backup, with all writes stopped.
        run(*(backup_command or ['/bin/sh', previous / 'deploy/run-backup.sh', backup_env]))
    except BaseException:
        run('launchctl', 'bootstrap', domain, plist)
        wait_health(True)
        raise
    try:
        switch(current, release)
        run('launchctl', 'bootstrap', domain, plist)
        wait_health(True)
    except BaseException:
        # New startup may have migrated the DB. Never silently pair it with old code.
        subprocess.run(['launchctl', 'bootout', service], check=False)
        raise RuntimeError('New release stopped. Keep its DB and restore the verified backup before rollback.') from None


def main(server_env, backup_env, root_value, revision):
    os.umask(0o077)
    if sys.platform != 'darwin' or not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Requires macOS and a full tested Git commit SHA')
    source = Path(__file__).resolve().parent.parent
    root = Path(root_value)
    storage = Path(os.environ['RESUME_STORAGE_ROOT']).resolve()
    if (not root.is_absolute() or not root.is_dir() or root.is_symlink()
            or not root.resolve().is_relative_to(storage) or root.resolve() == storage
            or root.stat().st_dev != storage.stat().st_dev
            or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077):
        raise ValueError('Release root must already exist privately on the verified SSD')
    root = root.resolve()
    for other in (source, Path(os.environ['RESUME_DATA_DIR']).resolve(), Path(os.environ['RESUME_MODEL_CACHE']).resolve()):
        if root.is_relative_to(other) or other.is_relative_to(root):
            raise ValueError('Release root, checkout, data, and cache must be separate')
    head = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if head != revision or subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain', '--untracked-files=no']):
        raise ValueError('Deployment checkout must be clean and match the tested SHA')
    backup_data = subprocess.check_output(['/bin/sh', '-c', '. "$1"; printf "%s" "$RESUME_DATA_DIR"', 'backup-env', backup_env], text=True)
    if Path(backup_data).resolve() != Path(os.environ['RESUME_DATA_DIR']).resolve():
        raise ValueError('Backup and app must use the same data directory')
    current = root / 'current'
    if not current.is_symlink() or not current.resolve(strict=True).is_relative_to(root):
        raise ValueError('Bootstrap the first release/current symlink manually before enabling CD')
    previous = current.resolve(strict=True)
    if not (previous / 'backend/.venv/bin/python').is_file():
        raise ValueError('Existing native release virtual environment is missing')
    plist = Path.home() / 'Library/LaunchAgents/com.resume-agent.app.plist'
    commands = service_commands(current, server_env, backup_env)
    # ponytail: one deployment on one Mac; a nonblocking file lock prevents overlapping invocations.
    with (root / '.deployment.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if os.path.lexists(root / '.current-next'):
            raise ValueError('Inspect the pending release switch before retrying')
        release = root / revision
        if release == previous:
            wait_health(True)
            print('This revision is already healthy')
            return
        release.mkdir(mode=0o700)  # Existing failed/staged releases require operator inspection.
        archive = release / 'source.tar'
        run('git', '-C', source, 'archive', '--format=tar', f'--output={archive}', revision, 'backend', 'deploy')
        with tarfile.open(archive) as packed:
            packed.extractall(release, filter='data')
        archive.unlink()
        uv = shutil.which('uv')
        if not uv:
            raise ValueError('Install uv 0.9.21 on the deployment account')
        run(uv, 'sync', '--frozen', '--project', release / 'backend')
        run('/bin/sh', release / 'deploy/run-app.sh', server_env, 'check')
        run(release / 'backend/.venv/bin/python', '-c', 'from app.deployment.config import get_settings; get_settings()', cwd=release / 'backend')
        activate(current, release, plist, server_env, backup_env, commands['backup'])
        print(f'Deployed {revision}; previous release retained at {previous.name}')


if __name__ == '__main__':
    try:
        main(*sys.argv[1:])
    except Exception as error:
        print(f'Deployment failed ({type(error).__name__}). Inspect release/backup state before retrying.', file=sys.stderr)
        sys.exit(1)

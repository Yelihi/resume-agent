import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('github_deploy', Path(__file__).with_name('github-deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTrustTest(unittest.TestCase):
    def test_only_matching_tested_main_run_can_deploy(self):
        sha = 'a' * 40
        deployment = {'environment': deploy.ENVIRONMENT, 'sha': sha, 'payload': {'run_id': 42, 'run_attempt': 1}}
        run = {
            'id': 42, 'run_attempt': 1, 'repository': {'full_name': deploy.REPOSITORY},
            'head_repository': {'full_name': deploy.REPOSITORY}, 'path': deploy.WORKFLOW,
            'head_branch': 'main', 'head_sha': sha, 'event': 'push', 'status': 'in_progress',
        }
        jobs = [
            {'name': 'checks', 'conclusion': 'success', 'status': 'completed'},
            {'name': 'backend', 'conclusion': None, 'status': 'in_progress'},
        ]
        self.assertTrue(deploy.eligible(deployment, run, jobs, sha))
        for key, value in {
            'event': 'pull_request', 'head_branch': 'other', 'head_sha': 'b' * 40,
            'path': '.github/workflows/other.yml', 'run_attempt': 2, 'id': 43,
            'status': 'completed', 'head_repository': {'full_name': 'someone/fork'},
        }.items():
            with self.subTest(key=key):
                changed = dict(run, **{key: value})
                self.assertFalse(deploy.eligible(deployment, changed, jobs, sha))
        self.assertFalse(deploy.eligible(deployment, run, jobs, 'b' * 40))
        for state in ('failure', 'skipped', None):
            changed = copy.deepcopy(jobs)
            changed[0]['conclusion'] = state
            self.assertFalse(deploy.eligible(deployment, run, changed, sha))


if __name__ == '__main__':
    unittest.main()

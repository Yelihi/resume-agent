import importlib.util
import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseSafetyTest(unittest.TestCase):
    def test_installed_app_commands_and_backup_before_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            agents = home / 'Library/LaunchAgents'
            agents.mkdir(parents=True)
            launcher = home / 'Applications/Resume Agent Service.app/Contents/MacOS/ResumeAgentService'
            launcher.parent.mkdir(parents=True)
            launcher.touch()
            current = Path('/Volumes/Storage2TB/server/resume-agent/release/current')
            server, backup = [str(home / '.config/resume-agent' / name) for name in ('server.env', 'backup.env')]
            for job in ('app', 'backup'):
                (agents / f'com.resume-agent.{job}.plist').write_bytes(plistlib.dumps({
                    'Label': f'com.resume-agent.{job}', 'ProgramArguments': [str(launcher), job],
                }))
            with patch.object(release.Path, 'home', return_value=home):
                commands = release.service_commands(current, server, backup)
                self.assertEqual(commands['backup'], [str(launcher), 'backup'])
                with self.assertRaises(ValueError):
                    release.service_commands(home / 'wrong/current', server, backup)
                with self.assertRaises(ValueError):
                    release.service_commands(current, server, '/wrong/backup.env')
            old, new = home / 'old', home / 'new'
            old.mkdir()
            new.mkdir()
            link = home / 'current'
            link.symlink_to(old)
            def execute(*args, **kwargs):
                if args[0] == str(launcher):
                    self.assertEqual(link.resolve(), old)
            with patch.object(release, 'run', side_effect=execute) as calls, patch.object(release, 'wait_health'):
                release.activate(link, new, agents / 'com.resume-agent.app.plist', server, backup, commands['backup'])
                self.assertIn(unittest.mock.call(str(launcher), 'backup'), calls.call_args_list)
                self.assertEqual(link.resolve(), new)

    def test_backup_failure_keeps_old_release_and_restarts_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            old = root / 'old'
            old.mkdir()
            current = root / 'current'
            current.symlink_to(old)
            def execute(*args, **kwargs):
                if args[0] == '/bin/sh':
                    raise subprocess.CalledProcessError(1, 'backup')
            with patch.object(release, 'run', side_effect=execute) as calls, patch.object(release, 'wait_health'):
                with self.assertRaises(subprocess.CalledProcessError):
                    release.activate(current, root / 'new', root / 'app.plist', 'server.env', 'backup.env')
                self.assertEqual(current.resolve(), old)
                self.assertEqual(calls.call_args.args[1], 'bootstrap')

    def test_new_health_failure_stops_service_without_unsafe_database_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            old, new = root / 'old', root / 'new'
            old.mkdir()
            new.mkdir()
            current = root / 'current'
            current.symlink_to(old)
            with patch.object(release, 'run'), patch.object(release, 'wait_health', side_effect=[None, RuntimeError('unhealthy')]), patch.object(release.subprocess, 'run') as stop:
                with self.assertRaisesRegex(RuntimeError, 'restore the verified backup'):
                    release.activate(current, new, root / 'app.plist', 'server.env', 'backup.env')
                self.assertEqual(current.resolve(), new)
                self.assertEqual(stop.call_args.args[0][1], 'bootout')
                self.assertTrue(old.is_dir())

    def test_backup_precedes_release_switch_and_startup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            old, new = root / 'old', root / 'new'
            old.mkdir()
            new.mkdir()
            current = root / 'current'
            current.symlink_to(old)
            def execute(*args, **kwargs):
                if args[0] == '/bin/sh':
                    self.assertEqual(current.resolve(), old)
                if args[1] == 'bootstrap':
                    self.assertEqual(current.resolve(), new)
            with patch.object(release, 'run', side_effect=execute) as calls, patch.object(release, 'wait_health'):
                release.activate(current, new, root / 'app.plist', 'server.env', 'backup.env')
                self.assertEqual(current.resolve(), new)
                self.assertEqual([c.args[1] for c in calls.call_args_list if c.args[0] == 'launchctl'], ['print', 'bootout', 'bootstrap'])


if __name__ == '__main__':
    unittest.main()

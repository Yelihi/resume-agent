import json
import sqlite3
import subprocess
from contextlib import closing

import pytest

from scripts import backup


@pytest.fixture
def source(tmp_path):
    directory = tmp_path / "data"
    (directory / "files").mkdir(parents=True)
    with closing(sqlite3.connect(directory / "resume.sqlite3")) as connection:
        connection.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE users(id TEXT PRIMARY KEY);
            CREATE TABLE files(id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id), size INTEGER);
            INSERT INTO users VALUES ('alice');
            INSERT INTO files VALUES ('original', 'alice', 8);
        """)
    (directory / "files/original").write_bytes(b"original")
    (directory / "files/unreferenced").write_bytes(b"ignore")
    return directory


def test_consistent_snapshot_blocks_gc_and_verifies_restored_files(source, tmp_path, monkeypatch):
    original_copy = backup.shutil.copyfile

    def locked_copy(*args, **kwargs):
        with closing(sqlite3.connect(source / "resume.sqlite3", timeout=0)) as writer:
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                writer.execute("BEGIN IMMEDIATE")
        return original_copy(*args, **kwargs)

    monkeypatch.setattr(backup.shutil, "copyfile", locked_copy)
    snapshot = tmp_path / "restored"
    backup.snapshot(source, snapshot)
    backup.verify_snapshot(snapshot)
    assert (snapshot.stat().st_mode & 0o077) == 0
    assert {path.name for path in (snapshot / "files").iterdir()} == {"original"}
    with closing(sqlite3.connect(source / "resume.sqlite3", timeout=0)) as writer:
        writer.execute("BEGIN IMMEDIATE")
        writer.rollback()
    (snapshot / "files/original").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="checksum"):
        backup.verify_snapshot(snapshot)


def test_backup_retention_status_and_private_failure(source, tmp_path, monkeypatch):
    password = tmp_path / "password"
    password.write_text("recovery-password-never-log")
    password.chmod(0o600)
    repository = tmp_path / "restic"
    repository.mkdir(mode=0o700)
    (repository / "config").write_text("initialized repository")
    for name, value in {"RESUME_BACKUP_MODE": "local", "RESTIC_REPOSITORY": str(repository), "RESTIC_PASSWORD_FILE": str(password), "RESTIC_PASSWORD_COMMAND": "must-not-run", "RESTIC_REPOSITORY_FILE": "must-not-read", "AWS_SECRET_ACCESS_KEY": "secret-never-log"}.items():
        monkeypatch.setenv(name, value)
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        assert kwargs["stderr"] is subprocess.DEVNULL
        assert kwargs["stdout"] is subprocess.DEVNULL
        assert not any(name.startswith(("RESTIC_", "AWS_")) for name in kwargs["env"])
        if command[1] == "backup":
            backup.verify_snapshot(kwargs["cwd"])

    monkeypatch.setattr(backup.subprocess, "run", fake_run)
    staging = tmp_path / "stage"
    assert not backup.run_backup(source, staging)
    assert not staging.exists()
    assert not calls
    staging.mkdir(mode=0o755)
    assert not backup.run_backup(source, staging)
    assert not calls
    staging.chmod(0o700)
    assert backup.run_backup(source, staging)
    options = ["--repo", str(repository), "--password-file", str(password)]
    assert calls[0] == ["restic", "backup", ".", "--tag", "resume-agent", *options]
    assert calls[1][1:] == ["forget", "--tag", "resume-agent", "--group-by", "host,tags", "--keep-daily", "7", "--keep-weekly", "4", "--keep-monthly", "3", "--prune", *options]
    status_path = source / "backup-status.json"
    successful = json.loads(status_path.read_text())
    assert successful["lastSuccessAt"] and successful["error"] is None
    assert status_path.stat().st_mode & 0o077 == 0
    assert list(staging.iterdir()) == []

    def failed_run(*args, **kwargs):
        raise RuntimeError("secret-never-log")

    monkeypatch.setattr(backup.subprocess, "run", failed_run)
    assert not backup.run_backup(source, staging)
    failed = json.loads(status_path.read_text())
    assert failed["lastSuccessAt"] == successful["lastSuccessAt"]
    assert failed["error"] == "BACKUP_OR_RETENTION_FAILED"
    assert "secret-never-log" not in status_path.read_text()
    assert list(staging.iterdir()) == []


def test_snapshot_rejects_missing_original(source, tmp_path):
    (source / "files/original").unlink()
    with pytest.raises(FileNotFoundError):
        backup.snapshot(source, tmp_path / "snapshot")


def test_backup_defaults_disabled_and_rejects_remote_or_overlapping_storage(source, tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(backup.subprocess, "run", lambda *args, **kwargs: calls.append(args))
    staging = tmp_path / "stage"
    staging.mkdir(mode=0o700)
    password = tmp_path / "password"
    password.write_text("recovery-password")
    password.chmod(0o600)
    monkeypatch.setenv("RESTIC_PASSWORD_FILE", str(password))
    local = tmp_path / "restic"
    local.mkdir(mode=0o700)
    (local / "config").write_text("initialized repository")
    monkeypatch.setenv("RESTIC_REPOSITORY", str(local))
    monkeypatch.delenv("RESUME_BACKUP_MODE", raising=False)
    assert not backup.run_backup(source, staging)
    monkeypatch.setenv("RESUME_BACKUP_MODE", "local")
    for value in ("s3:https://example.invalid/bucket", "rest:https://example.invalid/", "sftp:host:/repo", "rclone:remote:repo", "relative/path", str(tmp_path / "missing")):
        monkeypatch.setenv("RESTIC_REPOSITORY", value)
        assert not backup.run_backup(source, staging)
    for directory in (source, staging, source / "backup", staging / "backup", tmp_path):
        directory.mkdir(mode=0o700, exist_ok=True)
        directory.chmod(0o700)
        (directory / "config").write_text("initialized repository")
        monkeypatch.setenv("RESTIC_REPOSITORY", str(directory))
        assert not backup.run_backup(source, staging)
    assert not calls

"""Consistent SQLite/files snapshots and restic backup; no third-party imports."""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def external_directory(path: Path) -> Path:
    path = path.expanduser().resolve()
    if path.is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Backup and data directories must be outside the repository")
    return path


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshot(data_dir: Path, destination: Path) -> None:
    data_dir, destination = external_directory(data_dir), external_directory(destination)
    database = data_dir / "resume.sqlite3"
    if not database.is_file():
        raise ValueError("Database is missing")
    destination.mkdir(mode=0o700)
    (destination / "files").mkdir(mode=0o700)
    manifest = {}
    # ponytail: copying holds the SQLite writer lock; use filesystem snapshots if this becomes too slow.
    with closing(sqlite3.connect(database, timeout=30)) as lock:
        lock.execute("BEGIN IMMEDIATE")
        try:
            with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(destination / "resume.sqlite3")) as target:
                source.backup(target)
                files = target.execute("SELECT id, size FROM files").fetchall()
            for file_id, size in files:
                if not isinstance(file_id, str) or Path(file_id).name != file_id or file_id in {".", ".."}:
                    raise ValueError("Invalid file identity")
                source_file = data_dir / "files" / file_id
                if source_file.is_symlink() or source_file.stat().st_size != size:
                    raise ValueError("Original file does not match metadata")
                target_file = destination / "files" / file_id
                shutil.copyfile(source_file, target_file)
                manifest[file_id] = digest(target_file)
        finally:
            lock.rollback()
    (destination / "manifest.json").write_text(json.dumps({"files": manifest, "databaseSha256": digest(destination / "resume.sqlite3")}, sort_keys=True))


def verify_snapshot(directory: Path) -> None:
    directory = external_directory(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    database = directory / "resume.sqlite3"
    if digest(database) != manifest["databaseSha256"]:
        raise ValueError("Database checksum mismatch")
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or connection.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("Database integrity check failed")
        files = connection.execute("SELECT id, size FROM files").fetchall()
    if {file_id for file_id, _ in files} != set(manifest["files"]):
        raise ValueError("File manifest does not match database")
    for file_id, size in files:
        if Path(file_id).name != file_id or file_id in {".", ".."}:
            raise ValueError("Invalid file identity")
        path = directory / "files" / file_id
        if path.is_symlink() or path.stat().st_size != size or digest(path) != manifest["files"][file_id]:
            raise ValueError("Original file checksum mismatch")


def run_backup(data_dir: Path, staging_dir: Path, restic: str = "restic") -> bool:
    data_dir, staging_dir = external_directory(data_dir), external_directory(staging_dir)
    status_path = data_dir / "backup-status.json"
    previous = {}
    if status_path.exists():
        try:
            previous = json.loads(status_path.read_text())
        except (ValueError, OSError):
            pass
    status = {"lastAttemptAt": datetime.now(timezone.utc).isoformat(), "lastSuccessAt": previous.get("lastSuccessAt"), "error": None}
    try:
        for variable in ("RESTIC_REPOSITORY", "RESTIC_PASSWORD_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
            if not os.environ.get(variable):
                raise ValueError("Backup environment is incomplete")
        password = external_directory(Path(os.environ["RESTIC_PASSWORD_FILE"]))
        if not password.is_file() or password.stat().st_mode & 0o077:
            raise ValueError("Backup password file must be private")
        if (not staging_dir.is_dir() or staging_dir.stat().st_uid != os.getuid()
                or staging_dir.stat().st_mode & 0o077 or not os.access(staging_dir, os.W_OK | os.X_OK)):
            raise ValueError("Backup staging must be an existing owner-only writable directory")
        with tempfile.TemporaryDirectory(prefix="resume-backup-", dir=staging_dir) as temporary:
            destination = Path(temporary) / "snapshot"
            snapshot(data_dir, destination)
            verify_snapshot(destination)
            subprocess.run([restic, "backup", ".", "--tag", "resume-agent"], cwd=destination, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            status["lastSuccessAt"] = datetime.now(timezone.utc).isoformat()
            subprocess.run([restic, "forget", "--tag", "resume-agent", "--group-by", "host,tags", "--keep-daily", "7", "--keep-weekly", "4", "--keep-monthly", "3", "--prune"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        # Never persist subprocess messages: providers may include credentials or document paths.
        status["error"] = "BACKUP_OR_RETENTION_FAILED"
    descriptor, temporary_status = tempfile.mkstemp(prefix=".backup-status-", dir=data_dir)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(status, stream)
    os.replace(temporary_status, status_path)
    return status["error"] is None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", type=Path, help="Validate a restored snapshot without contacting restic")
    args = parser.parse_args()
    try:
        if args.verify:
            verify_snapshot(args.verify)
            print("Snapshot integrity and original file hashes verified.")
            return 0
        success = run_backup(Path(os.environ["RESUME_DATA_DIR"]), Path(os.environ["RESUME_BACKUP_STAGING_DIR"]), os.environ.get("RESTIC_BIN", "restic"))
        print("Backup complete." if success else "Backup failed; check backup-status.json.")
        return 0 if success else 1
    except Exception:
        print("Backup configuration or snapshot validation failed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

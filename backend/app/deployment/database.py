import sqlite3
import os
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from collections.abc import Iterator

from app.deployment.config import get_settings


class Database:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        if data_dir.stat().st_mode & 0o077 or data_dir.stat().st_uid != os.getuid():
            raise RuntimeError("Data directory must be owner-only (chmod 700)")
        with self.connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
                    disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1))
                );
                CREATE TABLE IF NOT EXISTS user_invitations (
                    email TEXT PRIMARY KEY
                );
                CREATE TABLE IF NOT EXISTS user_keys (
                    owner_id TEXT PRIMARY KEY REFERENCES users(id),
                    ciphertext BLOB NOT NULL, masked TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
                    filename TEXT NOT NULL, content_type TEXT NOT NULL,
                    size INTEGER NOT NULL CHECK(size >= 0),
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            """)
            connection.execute("BEGIN IMMEDIATE")
            if "disabled" not in {row["name"] for row in connection.execute("PRAGMA table_info(users)")}:
                connection.execute("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1))")

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.data_dir / "resume.sqlite3", timeout=10)
        os.chmod(self.data_dir / "resume.sqlite3", 0o600)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        try:
            with connection:
                yield connection
        finally:
            connection.close()


@lru_cache(maxsize=1)
def get_database() -> Database:
    return Database(get_settings().data_dir)

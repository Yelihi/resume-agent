import json
import sqlite3
from contextlib import closing

import pytest

from app.deployment.database import Database
from scripts.manage_users import main, manage


def test_legacy_schema_migration_preserves_identity_and_cli_controls_invites(tmp_path, capsys):
    with closing(sqlite3.connect(tmp_path / "resume.sqlite3")) as connection:
        connection.executescript("CREATE TABLE users(id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL); INSERT INTO users VALUES ('original-id','issuer|subject','Owner@Example.com');")
    database = Database(tmp_path)
    with database.connect() as connection:
        user = connection.execute("SELECT * FROM users").fetchone()
        assert tuple(user) == ("original-id", "issuer|subject", "Owner@Example.com", 0)
        assert not connection.execute("SELECT * FROM user_invitations").fetchall()
    assert main(["--data-dir", str(tmp_path), "invite", " Owner@Example.com "]) == 0
    assert json.loads(capsys.readouterr().out)["email"] == "owner@example.com"
    manage(database, "invite", "owner@example.com")
    listed = manage(database, "list")
    assert listed["invitations"] == ["owner@example.com"]
    assert listed["users"] == [{"id": "original-id", "email": "Owner@Example.com", "disabled": 0, "invited": 1}]
    manage(database, "disable", "original-id")
    assert manage(database, "list")["users"][0]["disabled"] == 1
    manage(database, "enable", "original-id")
    manage(database, "revoke", "OWNER@example.com")
    listed = manage(database, "list")
    assert listed["users"][0]["disabled"] == 0
    assert listed["users"][0]["invited"] == 0
    assert listed["invitations"] == []
    Database(tmp_path)  # Migration is repeatable and never grants an invitation.


def test_account_cli_rejects_invalid_targets_and_repository_paths(tmp_path):
    database = Database(tmp_path)
    for invalid in ("", "someone", "bad email@example.com", "bad@example.com\nsecond@example.com"):
        with pytest.raises(ValueError, match="email"):
            manage(database, "invite", invalid)
    with pytest.raises(ValueError, match="Unknown internal user ID"):
        manage(database, "disable", "missing")
    with pytest.raises(SystemExit):
        main(["--data-dir", ".", "invite", "owner@example.com"])

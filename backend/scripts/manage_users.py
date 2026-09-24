"""Owner-only host CLI. Run from backend: python -m scripts.manage_users --help."""

import argparse
import json
import os
import re
from pathlib import Path

from app.deployment.config import _external_path
from app.deployment.database import Database


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("A complete invitation email is required")
    return email


def manage(database: Database, command: str, value: str | None = None) -> dict:
    with database.connect() as connection:
        if command == "list":
            users = connection.execute("""
                SELECT id, email, disabled,
                    EXISTS(SELECT 1 FROM user_invitations i WHERE i.email=lower(trim(users.email))) AS invited
                FROM users ORDER BY email, id
            """).fetchall()
            invitations = connection.execute("SELECT email FROM user_invitations ORDER BY email").fetchall()
            return {"users": [dict(row) for row in users], "invitations": [row["email"] for row in invitations]}
        if command in {"invite", "revoke"}:
            email = normalize_email(value or "")
            if command == "invite":
                connection.execute("INSERT INTO user_invitations(email) VALUES (?) ON CONFLICT(email) DO NOTHING", (email,))
            else:
                connection.execute("DELETE FROM user_invitations WHERE email=?", (email,))
            return {"command": command, "email": email}
        if command in {"disable", "enable"}:
            changed = connection.execute("UPDATE users SET disabled=? WHERE id=?", (int(command == "disable"), value))
            if changed.rowcount != 1:
                raise ValueError("Unknown internal user ID")
            return {"command": command, "id": value}
        raise ValueError("Unknown account command")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=os.environ.get("RESUME_DATA_DIR"), help="Absolute database directory outside Git; defaults to RESUME_DATA_DIR")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="List invitation emails and internal account IDs/status")
    for command in ("invite", "revoke", "disable", "enable"):
        subparser = commands.add_parser(command)
        subparser.add_argument("value", metavar="EMAIL" if command in {"invite", "revoke"} else "USER_ID")
    args = parser.parse_args(argv)
    if args.data_dir is None:
        parser.error("--data-dir or RESUME_DATA_DIR is required")
    try:
        data_dir = _external_path(str(args.data_dir), "RESUME_DATA_DIR")
        result = manage(Database(data_dir), args.command, getattr(args, "value", None))
    except (ValueError, RuntimeError) as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

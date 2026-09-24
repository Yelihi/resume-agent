import os
import re
import stat
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet


@dataclass(frozen=True)
class Settings:
    mode: str
    data_dir: Path
    key_file: Path | None
    public_origin: str
    access_team_domain: str
    access_audience: str
    access_assertion_header: str


def _external_path(value: str, name: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute() or path.resolve().is_relative_to(Path(__file__).resolve().parents[3]):
        raise RuntimeError(f"{name} must be an absolute path outside the repository")
    return path.resolve()


def read_encryption_key(path: Path) -> bytes:
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077 or metadata.st_uid != os.getuid():
        raise RuntimeError("RESUME_KEY_FILE must be an owner-only regular file")
    key = path.read_bytes().strip()
    try:
        Fernet(key)
    except ValueError:
        raise RuntimeError("RESUME_KEY_FILE does not contain a valid Fernet key") from None
    return key


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    mode = os.environ.get("RESUME_DEPLOYMENT_MODE", "local")
    if mode not in {"local", "server"}:
        raise RuntimeError("RESUME_DEPLOYMENT_MODE must be local or server")
    required = ("RESUME_DATA_DIR", "RESUME_KEY_FILE", "RESUME_PUBLIC_ORIGIN", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD")
    if mode == "server" and any(not os.environ.get(name) for name in required):
        raise RuntimeError("Server mode requires " + ", ".join(required))
    data_dir = _external_path(os.environ.get("RESUME_DATA_DIR") or str(Path.home() / "Library/Application Support/resume-agent"), "RESUME_DATA_DIR")
    key_path = os.environ.get("RESUME_KEY_FILE")
    key_file = _external_path(key_path, "RESUME_KEY_FILE") if key_path else None
    if key_file:
        read_encryption_key(key_file)
    origin = os.environ.get("RESUME_PUBLIC_ORIGIN", "")
    domain = os.environ.get("CF_ACCESS_TEAM_DOMAIN", "")
    assertion_header = os.environ.get("RESUME_ACCESS_ASSERTION_HEADER", "cf-access-jwt-assertion")
    if assertion_header not in {"cf-access-jwt-assertion", "x-resume-user-jwt"}:
        raise RuntimeError("RESUME_ACCESS_ASSERTION_HEADER must be cf-access-jwt-assertion or x-resume-user-jwt")
    if mode == "server":
        parsed = urlsplit(origin)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or origin != f"https://{parsed.netloc}":
            raise RuntimeError("RESUME_PUBLIC_ORIGIN must be an HTTPS origin without a path")
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com", domain):
            raise RuntimeError("CF_ACCESS_TEAM_DOMAIN must be your team.cloudflareaccess.com hostname")
    return Settings(mode, data_dir, key_file, origin, domain, os.environ.get("CF_ACCESS_AUD", ""), assertion_header)

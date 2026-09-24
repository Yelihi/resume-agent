"""Read-only startup checks for the local external SSD; never create storage paths."""

import os
import plistlib
import stat
import subprocess
import sys
from pathlib import Path


def check_private_file(value, label):
    path = Path(value)
    if not path.is_absolute() or not path.is_file():
        raise SystemExit(f"{label} must be an existing absolute file")
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise SystemExit(f"{label} must be owner-only and owned by this user")
    return path.resolve()


def check_storage():
    root = Path(os.environ.get("RESUME_STORAGE_ROOT", ""))
    expected_uuid = os.environ.get("RESUME_STORAGE_UUID", "")
    if not root.is_absolute() or not root.is_dir() or root.is_symlink() or not expected_uuid:
        raise SystemExit("Set RESUME_STORAGE_ROOT and RESUME_STORAGE_UUID for the mounted external APFS SSD")
    try:
        info = plistlib.loads(subprocess.check_output(["diskutil", "info", "-plist", str(root)], stderr=subprocess.DEVNULL))
    except (OSError, subprocess.CalledProcessError, plistlib.InvalidFileException):
        raise SystemExit("Cannot verify the mounted external APFS SSD") from None
    if (info.get("MountPoint") != str(root) or info.get("VolumeUUID") != expected_uuid
            or info.get("FilesystemType", "").lower() != "apfs" or info.get("Internal") is not False):
        raise SystemExit("Storage must be the expected mounted external APFS SSD, not a directory or network share")
    sentinel = root / ".resume-agent-volume"
    if not sentinel.is_file() or sentinel.is_symlink() or sentinel.read_text().strip() != expected_uuid:
        raise SystemExit("SSD sentinel .resume-agent-volume does not match RESUME_STORAGE_UUID")
    repository = Path(__file__).resolve().parent.parent
    for name in ("RESUME_DATA_DIR", "RESUME_MODEL_CACHE"):
        path = Path(os.environ.get(name, ""))
        if (not path.is_absolute() or not path.is_dir() or not path.resolve().is_relative_to(root.resolve())
                or path.resolve().is_relative_to(repository) or path.resolve() == root.resolve()
                or path.stat().st_dev != root.stat().st_dev or not os.access(path, os.W_OK)):
            raise SystemExit(f"{name} must be an existing writable directory on this SSD, outside the repository")
        metadata = path.stat()
        if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o700:
            raise SystemExit(f"{name} must be owned by this user with chmod 700 permissions")
    data = Path(os.environ["RESUME_DATA_DIR"]).resolve()
    cache = Path(os.environ["RESUME_MODEL_CACHE"]).resolve()
    if data.is_relative_to(cache) or cache.is_relative_to(data):
        raise SystemExit("Data and model cache directories must be separate")
    key = check_private_file(os.environ.get("RESUME_KEY_FILE", ""), "Encryption key")
    if key.is_relative_to(repository) or key.is_relative_to(data) or key.is_relative_to(cache):
        raise SystemExit("Encryption key must be outside the repository, data, and model-cache mounts")
    if os.getuid() == 0:
        raise SystemExit("Run as the key owner, not root")


def self_test():
    import tempfile
    from unittest.mock import patch

    with tempfile.TemporaryDirectory(prefix="resume-storage-check-") as directory:
        base = Path(directory)
        absent = base / "missing-ssd"
        environment = {"RESUME_DEPLOYMENT_MODE": "server", "RESUME_STORAGE_ROOT": str(absent), "RESUME_STORAGE_UUID": "expected"}
        settings = base / "server.env"
        settings.write_text("\n".join(f"{key}='{value}'" for key, value in environment.items()))
        settings.chmod(0o600)
        for script in ("run-app.sh", "run-containers.sh"):
            result = subprocess.run(["/bin/sh", str(Path(__file__).parent / script), str(settings), "check"], capture_output=True, text=True)
            assert result.returncode and "mounted external APFS SSD" in result.stderr, result.stderr
            assert not absent.exists(), "Preflight created a directory for a missing SSD"
        root = base / "ssd"
        root.mkdir(mode=0o700)
        (root / ".resume-agent-volume").write_text("expected")
        for name in ("data", "cache"):
            (root / name).mkdir(mode=0o700)
        key = base / "key"
        key.write_text("test metadata only; not an encryption key")
        key.chmod(0o600)
        environment.update(RESUME_STORAGE_ROOT=str(root), RESUME_DATA_DIR=str(root / "data"), RESUME_MODEL_CACHE=str(root / "cache"), RESUME_KEY_FILE=str(key))
        info = dict(MountPoint=str(root), VolumeUUID="expected", FilesystemType="apfs", Internal=False)
        with patch.dict(os.environ, environment), patch.object(subprocess, "check_output", return_value=plistlib.dumps(info)):
            check_storage()
            (root / "data").chmod(0o755)
            try:
                check_storage()
            except SystemExit as error:
                assert "chmod 700" in str(error), error
            else:
                raise AssertionError("World-readable data directory was accepted")
            (root / "data").chmod(0o700)
            (root / ".resume-agent-volume").write_text("wrong-volume")
            try:
                check_storage()
            except SystemExit as error:
                assert "sentinel" in str(error), error
            else:
                raise AssertionError("Wrong SSD sentinel was accepted")
    print("Native/Docker missing SSD, directory permissions, and volume sentinel checks passed")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif len(sys.argv) == 3 and sys.argv[1] == "--env-file":
        check_private_file(sys.argv[2], "Environment file")
    elif len(sys.argv) == 1:
        check_storage()
    else:
        raise SystemExit("Usage: check-storage.py [--self-test | --env-file /absolute/file]")

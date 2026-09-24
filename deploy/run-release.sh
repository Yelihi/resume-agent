#!/bin/sh
set -eu
umask 077
deploy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
server_env=${1:?Pass server.env, backup.env, release root, and commit SHA}
backup_env=${2:?Pass backup.env}
release_root=${3:?Pass the existing external SSD release root}
revision=${4:?Pass the tested commit SHA}
python3 "$deploy_dir/check-storage.py" --env-file "$server_env"
python3 "$deploy_dir/check-storage.py" --env-file "$backup_env"
set -a
. "$server_env"
set +a
test "${RESUME_DEPLOYMENT_MODE:-}" = server
python3 "$deploy_dir/check-storage.py"
export UV_CACHE_DIR="$RESUME_MODEL_CACHE/uv"
exec uv run --no-project --python 3.12 python "$deploy_dir/release.py" "$server_env" "$backup_env" "$release_root" "$revision"

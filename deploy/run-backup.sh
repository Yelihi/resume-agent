#!/bin/sh
set -eu
umask 077
deploy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
environment_file=${1:?Pass the absolute path to the private backup environment file}
python3 "$deploy_dir/check-storage.py" --env-file "$environment_file"
set -a
. "$environment_file"
set +a
exec "$deploy_dir/../backend/.venv/bin/python" "$deploy_dir/../backend/scripts/backup.py"

#!/bin/sh
set -eu
umask 077
deploy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "${1:-}" = --self-test ]; then
    exec python3 "$deploy_dir/check-storage.py" --self-test
fi
environment_file=${1:?Pass the absolute path to the private server environment file}
python3 "$deploy_dir/check-storage.py" --env-file "$environment_file"
set -a
. "$environment_file"
set +a
: "${RESUME_DEPLOYMENT_MODE:?Set server deployment mode}"
test "$RESUME_DEPLOYMENT_MODE" = server
python3 "$deploy_dir/check-storage.py"
export PADDLE_PDX_CACHE_HOME="$RESUME_MODEL_CACHE/paddlex"
export PADDLE_HOME="$RESUME_MODEL_CACHE/paddle"
export XDG_CACHE_HOME="$RESUME_MODEL_CACHE/.cache"
export HF_HOME="$RESUME_MODEL_CACHE/huggingface"
if [ "${2:-}" = check ]; then
    echo "SSD, cache, and key permissions checks passed"
    exit 0
fi
cd "$deploy_dir/../backend"
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers --no-access-log

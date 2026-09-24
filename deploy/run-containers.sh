#!/bin/sh
set -eu
umask 077

deployment_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "${1:-}" = --self-test ]; then
    exec python3 "$deployment_dir/check-storage.py" --self-test
fi

environment_file=${1:?Pass the absolute owner-only environment file, then check/build/up/down/logs/ps}
action=${2:-check}
case "$action" in check|build|up|down|logs|ps) ;; *) echo "Unsupported action" >&2; exit 2;; esac
python3 "$deployment_dir/check-storage.py" --env-file "$environment_file"
set -a
. "$environment_file"
set +a
RESUME_CONTAINER_UID=$(id -u)
RESUME_CONTAINER_GID=$(id -g)
export RESUME_CONTAINER_UID RESUME_CONTAINER_GID
compose() { docker compose --env-file /dev/null -f "$deployment_dir/compose.yaml" "$@"; }
# Stopping/inspecting must still work after an accidental SSD disconnection.
case "$action" in
  down) compose down; exit ;;
  logs) compose logs --tail 100; exit ;;
  ps) compose ps; exit ;;
esac

# Never mkdir/chown a volume path: a missing SSD must fail before Docker receives a mount.
python3 "$deployment_dir/check-storage.py"
compose config --quiet
endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
case "$endpoint" in unix://*) ;; *) echo "Use a local Docker context for the external SSD bind mounts" >&2; exit 1;; esac
architecture=$(docker info --format '{{.Architecture}}')
case "$architecture" in aarch64|arm64) ;; *) echo "Docker must run native ARM64; emulation is not enabled by this script" >&2; exit 1;; esac
case "$action" in
  check) echo "SSD, key permissions, Compose, and native ARM64 Docker checks passed" ;;
  build) compose build ;;
  up)
    compose build
    compose run --rm --no-deps --entrypoint python backend -c \
      'import os; from app.deployment.config import get_settings; get_settings(); assert os.getuid() != 0; import paddle; paddle.utils.run_check()'
    compose up --detach --wait
    ;;
esac

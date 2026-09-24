# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm AS runtime
ARG BUILDPLATFORM
ARG TARGETPLATFORM
RUN test "$BUILDPLATFORM" = "$TARGETPLATFORM" && test "$TARGETPLATFORM" = linux/arm64
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

FROM runtime AS dependencies
COPY --from=ghcr.io/astral-sh/uv:0.9.21 /uv /usr/local/bin/uv
WORKDIR /srv/resume/backend
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --no-editable --no-build --no-cache

FROM runtime
ARG APP_UID=10001
ARG APP_GID=10001
RUN case "$APP_UID:$APP_GID" in *[!0-9:]*|0:*|*:0) exit 1;; esac \
    && (getent group "$APP_GID" >/dev/null || groupadd --gid "$APP_GID" resume) \
    && useradd --uid "$APP_UID" --gid "$APP_GID" --no-create-home --home-dir /model-cache --shell /usr/sbin/nologin resume \
    && mkdir -p /data /model-cache /keys \
    && chown "$APP_UID:$APP_GID" /data /model-cache
WORKDIR /srv/resume/backend
COPY --from=dependencies /srv/resume/backend/.venv ./.venv
COPY app ./app
COPY scripts ./scripts
ENV PATH="/srv/resume/backend/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    XDG_CACHE_HOME=/model-cache/.cache PADDLE_HOME=/model-cache/paddle \
    PADDLE_PDX_CACHE_HOME=/model-cache/paddlex \
    HF_HOME=/model-cache/huggingface OMP_NUM_THREADS=2
USER ${APP_UID}:${APP_GID}
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers", "--no-access-log"]

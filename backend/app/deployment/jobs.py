"""One AI job per process; deployment runs one application worker."""
import asyncio
from contextlib import asynccontextmanager, suppress

from app.deployment.auth import User, require_active_user
from app.document_processing.models import ModuleErrorDTO
from app.errors import ApiError


class AiCapacity:
    # ponytail: process-local capacity; use a shared lease before adding workers.
    def __init__(self):
        self.busy = False

    def acquire(self):
        if self.busy:
            raise ApiError(409, [ModuleErrorDTO(moduleKey="aiExecution", inputSourceId=None,
                errorCode="AI_BUSY", userMessage="다른 AI 작업이 진행 중입니다. 완료 후 다시 시도해 주세요.", canRetry=True)])
        self.busy = True

    def release(self):
        self.busy = False


ai_capacity = AiCapacity()


REVOCATION_CHECK_SECONDS = 5


@asynccontextmanager
async def watch_user(user: User | None):
    """Cancel ongoing work within five seconds of an account being revoked."""
    if user is None:
        yield
        return
    require_active_user(user)
    operation = asyncio.current_task()

    async def monitor():
        while True:
            await asyncio.sleep(REVOCATION_CHECK_SECONDS)
            try:
                require_active_user(user)
            except Exception:
                operation.cancel()
                return

    watcher = asyncio.create_task(monitor())
    try:
        yield
    finally:
        watcher.cancel()
        with suppress(asyncio.CancelledError):
            await watcher

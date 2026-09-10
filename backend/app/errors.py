from abc import ABC, abstractmethod

from app.document_processing.models import ModuleErrorDTO


class ApplicationError(Exception, ABC):
    status_code: int
    errors: list[ModuleErrorDTO]

    @abstractmethod
    def __init__(self) -> None:
        super().__init__()


class ApiError(ApplicationError):
    def __init__(self, status_code: int, errors: list[ModuleErrorDTO]) -> None:
        super().__init__()
        self.status_code = status_code
        self.errors = errors
        self.args = (errors[0].errorCode,)


class MissingOpenAiApiKeyError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            503,
            [
                ModuleErrorDTO(
                    moduleKey="reviewConfiguration",
                    inputSourceId=None,
                    errorCode="OPENAI_API_KEY_MISSING",
                    userMessage="OpenAI API 키가 설정되지 않았습니다. 서버 실행 설정을 확인해 주세요.",
                    canRetry=False,
                )
            ],
        )


class ReviewExecutionError(ApiError):
    def __init__(self, status_code: int, error_code: str, user_message: str) -> None:
        super().__init__(
            status_code,
            [
                ModuleErrorDTO(
                    moduleKey="reviewExecution",
                    inputSourceId=None,
                    errorCode=error_code,
                    userMessage=user_message,
                    canRetry=False,
                )
            ],
        )


class ReviewNotFoundError(ReviewExecutionError):
    def __init__(self) -> None:
        super().__init__(404, "REVIEW_NOT_FOUND", "검토 실행을 찾을 수 없습니다.")


class ReviewAlreadyRunningError(ReviewExecutionError):
    def __init__(self) -> None:
        super().__init__(409, "REVIEW_ALREADY_RUNNING", "현재 이력서 검토가 끝난 뒤 다시 시도해 주세요.")


class ReviewInProgressError(ReviewExecutionError):
    def __init__(self) -> None:
        super().__init__(409, "REVIEW_IN_PROGRESS", "이력서 검토가 진행 중입니다.")


class RetryNotAvailableError(ReviewExecutionError):
    def __init__(self) -> None:
        super().__init__(409, "RETRY_NOT_AVAILABLE", "현재 이 모듈을 다시 실행할 수 없습니다.")

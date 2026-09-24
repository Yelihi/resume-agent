import { ApplicationApiError, MissingOpenAiApiKeyError, FileTooLargeApiError, TextTooLongApiError, EmptyFileApiError, EmptyTextApiError, CorruptFileApiError, EncryptedPdfApiError, NoExtractableTextApiError, OcrQualityTooLowApiError, InvalidCoordinatesApiError, InvalidRequestApiError, ReviewNotFoundApiError, ReviewAlreadyRunningApiError, ReviewInProgressApiError, RetryNotAvailableApiError, NotFoundApiError, ConflictApiError, PayloadTooLargeApiError, UnsupportedMediaTypeApiError, RequestValidationApiError, InternalApiError, NetworkApiError } from "../../domain/shared/errors";
import type { ModuleErrorDTO } from "../../domain/shared/contracts";
export * from "../../domain/shared/errors";

type ErrorConstructor = new (
  message: string,
  errors: ModuleErrorDTO[],
  status: number,
) => ApplicationApiError;

const errorTypesByCode: Record<string, ErrorConstructor> = {
  OPENAI_API_KEY_MISSING: MissingOpenAiApiKeyError,
  FILE_TOO_LARGE: FileTooLargeApiError,
  TEXT_TOO_LONG: TextTooLongApiError,
  EMPTY_FILE: EmptyFileApiError,
  EMPTY_TEXT: EmptyTextApiError,
  UNSUPPORTED_MEDIA_TYPE: UnsupportedMediaTypeApiError,
  CORRUPT_IMAGE: CorruptFileApiError,
  CORRUPT_PDF: CorruptFileApiError,
  ENCRYPTED_PDF: EncryptedPdfApiError,
  NO_EXTRACTABLE_TEXT: NoExtractableTextApiError,
  OCR_QUALITY_TOO_LOW: OcrQualityTooLowApiError,
  INVALID_COORDINATES: InvalidCoordinatesApiError,
  INVALID_REQUEST: InvalidRequestApiError,
  REVIEW_NOT_FOUND: ReviewNotFoundApiError,
  REVIEW_ALREADY_RUNNING: ReviewAlreadyRunningApiError,
  REVIEW_IN_PROGRESS: ReviewInProgressApiError,
  RETRY_NOT_AVAILABLE: RetryNotAvailableApiError,
};

const errorTypesByStatus: Record<number, ErrorConstructor> = {
  404: NotFoundApiError,
  409: ConflictApiError,
  413: PayloadTooLargeApiError,
  415: UnsupportedMediaTypeApiError,
  422: RequestValidationApiError,
};

function parseErrors(value: unknown): ModuleErrorDTO[] | null {
  if (!value || typeof value !== "object" || !("errors" in value) || !Array.isArray(value.errors)) {
    return null;
  }
  const valid = value.errors.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.moduleKey === "string" &&
      (item.inputSourceId === null || typeof item.inputSourceId === "string") &&
      typeof item.errorCode === "string" &&
      typeof item.userMessage === "string" &&
      typeof item.canRetry === "boolean",
  );
  return valid ? (value.errors as ModuleErrorDTO[]) : null;
}

export async function apiResponse(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, init);
  } catch {
    throw new NetworkApiError("서버에 연결할 수 없습니다.", [], 0, "NETWORK_UNAVAILABLE");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const errors = parseErrors(body);
    if (!errors) {
      throw new InternalApiError(
        "요청을 처리하지 못했습니다.",
        [],
        response.status,
        "INVALID_ERROR_RESPONSE",
      );
    }
    const ErrorType =
      errorTypesByCode[errors[0]?.errorCode] ??
      errorTypesByStatus[response.status] ??
      InternalApiError;
    throw new ErrorType(errors[0]?.userMessage ?? "요청을 처리하지 못했습니다.", errors, response.status);
  }
  return response;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiResponse(path, init);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

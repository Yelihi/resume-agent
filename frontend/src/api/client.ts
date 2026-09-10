import type { components } from "./schema";

export type ModuleErrorDTO = components["schemas"]["ModuleErrorDTO"];

export abstract class ApplicationApiError extends Error {
  readonly code: string;

  constructor(
    message: string,
    public readonly errors: ModuleErrorDTO[],
    public readonly status: number,
    code = errors[0]?.errorCode ?? "UNKNOWN_ERROR",
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class MissingOpenAiApiKeyError extends ApplicationApiError {}
export class FileTooLargeApiError extends ApplicationApiError {}
export class TextTooLongApiError extends ApplicationApiError {}
export class EmptyFileApiError extends ApplicationApiError {}
export class EmptyTextApiError extends ApplicationApiError {}
export class CorruptFileApiError extends ApplicationApiError {}
export class EncryptedPdfApiError extends ApplicationApiError {}
export class NoExtractableTextApiError extends ApplicationApiError {}
export class OcrQualityTooLowApiError extends ApplicationApiError {}
export class InvalidCoordinatesApiError extends ApplicationApiError {}
export class InvalidRequestApiError extends ApplicationApiError {}
export class ReviewNotFoundApiError extends ApplicationApiError {}
export class ReviewAlreadyRunningApiError extends ApplicationApiError {}
export class ReviewInProgressApiError extends ApplicationApiError {}
export class RetryNotAvailableApiError extends ApplicationApiError {}
export class NotFoundApiError extends ApplicationApiError {}
export class ConflictApiError extends ApplicationApiError {}
export class PayloadTooLargeApiError extends ApplicationApiError {}
export class UnsupportedMediaTypeApiError extends ApplicationApiError {}
export class RequestValidationApiError extends ApplicationApiError {}
export class InternalApiError extends ApplicationApiError {}
export class NetworkApiError extends ApplicationApiError {}
export class ClientApplicationError extends ApplicationApiError {}

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

export function toApplicationApiError(error: unknown, fallbackMessage: string): ApplicationApiError {
  if (error instanceof ApplicationApiError) return error;
  return new ClientApplicationError(
    error instanceof Error ? error.message : fallbackMessage,
    [],
    0,
    "CLIENT_ERROR",
  );
}

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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

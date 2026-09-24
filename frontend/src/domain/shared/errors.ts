import type { ModuleErrorDTO } from "./contracts";
export type { ModuleErrorDTO } from "./contracts";

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

export function toApplicationApiError(error: unknown, fallbackMessage: string): ApplicationApiError {
  if (error instanceof ApplicationApiError) return error;
  return new ClientApplicationError(
    error instanceof Error ? error.message : fallbackMessage,
    [],
    0,
    "CLIENT_ERROR",
  );
}

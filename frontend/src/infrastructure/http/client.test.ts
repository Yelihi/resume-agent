import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConflictApiError,
  FileTooLargeApiError,
  InternalApiError,
  MissingOpenAiApiKeyError,
  PayloadTooLargeApiError,
  RequestValidationApiError,
  ReviewAlreadyRunningApiError,
  ReviewNotFoundApiError,
  apiFetch,
} from "./client";

afterEach(() => vi.unstubAllGlobals());

const errorBody = (errorCode: string) => ({
  errors: [
    {
      moduleKey: "test",
      inputSourceId: null,
      errorCode,
      userMessage: "안전한 메시지",
      canRetry: false,
    },
  ],
});

describe("apiFetch", () => {
  it.each([
    [413, PayloadTooLargeApiError],
    [422, RequestValidationApiError],
    [409, ConflictApiError],
  ])("maps HTTP %s to an explicit error class", async (status, ErrorType) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorBody("TEST")), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const promise = apiFetch("/api/test");

    await expect(promise).rejects.toBeInstanceOf(ErrorType);
    await expect(promise).rejects.toMatchObject({ errors: errorBody("TEST").errors });
  });

  it("falls back to a safe internal error when the error body is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("proxy failure", { status: 502 })));

    const promise = apiFetch("/api/test");

    await expect(promise).rejects.toBeInstanceOf(InternalApiError);
    await expect(promise).rejects.not.toThrow(/proxy failure/);
  });

  it("maps a server error code to its concrete error class", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(errorBody("OPENAI_API_KEY_MISSING")), { status: 503 }),
      ),
    );

    const promise = apiFetch("/api/reviews/flow");

    await expect(promise).rejects.toBeInstanceOf(MissingOpenAiApiKeyError);
    await expect(promise).rejects.toMatchObject({ code: "OPENAI_API_KEY_MISSING", status: 503 });
  });

  it.each([
    ["FILE_TOO_LARGE", 413, FileTooLargeApiError],
    ["REVIEW_NOT_FOUND", 404, ReviewNotFoundApiError],
    ["REVIEW_ALREADY_RUNNING", 409, ReviewAlreadyRunningApiError],
  ])("maps %s independently of its HTTP status fallback", async (code, status, ErrorType) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(errorBody(code)), { status })),
    );

    await expect(apiFetch("/api/test")).rejects.toBeInstanceOf(ErrorType);
  });

  it("returns typed JSON for a successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "ok" })));

    await expect(apiFetch<{ status: string }>("/health")).resolves.toEqual({ status: "ok" });
  });
});

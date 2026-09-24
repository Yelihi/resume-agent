import { apiFetch } from "../http/client";
import type { components } from "../http/schema";
import type { FlowDocument, PageDocument } from "../../domain/resume/contracts";

import type { ReferenceMaterial } from "../../domain/material/contracts";
import type { PreviousReview, ReviewRecord } from "../../domain/review/contracts";
import type { RetryModule, ProgressEvent } from "../../domain/review/ports";
export type { ReviewResponse, ReviewRecord } from "../../domain/review/contracts";
export type { ProgressEvent } from "../../domain/review/ports";

export async function startReview(
  kind: "page" | "flow",
  document: PageDocument | FlowDocument,
  materials: ReferenceMaterial[],
  previousReview?: PreviousReview,
  reviewContext?: components["schemas"]["ReviewContext"],
): Promise<string> {
  const response = await apiFetch<components["schemas"]["RunAccepted"]>(
    `/api/reviews/${kind}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document, materials, previousReview, reviewContext }),
    },
  );
  return response.runId;
}

export const getReviewRecord = (runId: string) =>
  apiFetch<ReviewRecord>(`/api/reviews/${runId}/record`);

export const releaseReview = (runId: string) =>
  apiFetch<void>(`/api/reviews/${runId}`, { method: "DELETE" });

export const cancelReview = (runId: string) =>
  apiFetch<components["schemas"]["CancelAccepted"]>(`/api/reviews/${runId}/cancel`, {
    method: "POST",
  });

export const retryReview = (record: ReviewRecord, moduleKey: RetryModule) =>
  apiFetch<components["schemas"]["RunAccepted"]>("/api/reviews/retry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record, moduleKey }),
  });

export function followReview(
  runId: string,
  onProgress: (progress: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const source = new EventSource(
      `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/reviews/${runId}/events`,
    );
    let closed = false;
    const close = () => { closed = true; source.close(); signal?.removeEventListener("abort", abort); };
    const abort = () => { close(); reject(signal?.reason); };
    signal?.addEventListener("abort", abort, { once: true });
    for (const event of ["spellCheck", "referenceAnalysis", "finalReview", "completed", "cancelled", "failed"]) {
      source.addEventListener(event, (message) => {
        if (closed) return;
        try {
          const data: unknown = JSON.parse((message as MessageEvent).data);
          if (!data || typeof data !== "object" || !("message" in data) || typeof data.message !== "string") {
            throw new Error("진행 상태 응답을 확인할 수 없습니다.");
          }
          onProgress({ event, message: data.message });
          if (event === "failed") { close(); reject(new Error(data.message)); return; }
          if (event === "completed" || event === "cancelled") { close(); resolve(); }
        } catch (error) { close(); reject(error); }
      });
    }
    source.onerror = () => { if (!closed) { close(); reject(new Error("진행 상태 연결이 끊겼습니다.")); } };
  });
}

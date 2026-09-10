import { apiFetch } from "./client";
import type { components } from "./schema";
import type { FlowDocument, PageDocument } from "./resume";

export type ReferenceMaterial = components["schemas"]["ReferenceMaterial"];
export type PreviousReview = components["schemas"]["PreviousReview"];
export type ReviewResponse = components["schemas"]["ReviewResponse"];
export type ReviewRecord = components["schemas"]["ReviewRecord"];
export type RetryModule = components["schemas"]["RetryRequest"]["moduleKey"];
export type ProgressEvent = { event: string; message: string };

export async function startReview(
  kind: "page" | "flow",
  document: PageDocument | FlowDocument,
  materials: ReferenceMaterial[],
  previousReview?: PreviousReview,
): Promise<string> {
  const response = await apiFetch<components["schemas"]["RunAccepted"]>(
    `/api/reviews/${kind}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document, materials, previousReview }),
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
): Promise<void> {
  return new Promise((resolve, reject) => {
    const source = new EventSource(
      `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/reviews/${runId}/events`,
    );
    for (const event of ["spellCheck", "referenceAnalysis", "finalReview", "completed", "cancelled"]) {
      source.addEventListener(event, (message) => {
        const data = JSON.parse((message as MessageEvent).data) as { message: string };
        onProgress({ event, message: data.message });
        if (event === "completed" || event === "cancelled") {
          source.close();
          resolve();
        }
      });
    }
    source.onerror = () => {
      source.close();
      reject(new Error("진행 상태 연결이 끊겼습니다."));
    };
  });
}

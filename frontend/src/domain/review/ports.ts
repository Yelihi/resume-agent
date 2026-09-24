import type { ResumeDocument } from "../resume/entities";
import type { ReferenceMaterial } from "../material/contracts";
import type { ReviewRecord, ReviewContext, PreviousReview } from "./contracts";
export type RetryModule = "spellCheck" | "jobPostingAnalysis" | "companyContextAnalysis" | "finalReview";
export type ProgressEvent = { event: string; message: string };
export interface ReviewGateway {
  startReview(kind: "page" | "flow", document: ResumeDocument, materials: ReferenceMaterial[], previousReview?: PreviousReview, reviewContext?: ReviewContext): Promise<string>;
  getReviewRecord(runId: string): Promise<ReviewRecord>;
  releaseReview(runId: string): Promise<void>;
  cancelReview(runId: string): Promise<{ runId: string; cancelRequested: boolean }>;
  retryReview(record: ReviewRecord, moduleKey: RetryModule): Promise<{ runId: string }>;
  followReview(runId: string, onProgress: (progress: ProgressEvent) => void, signal?: AbortSignal): Promise<void>;
}

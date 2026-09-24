import type { SuggestionDTO as Suggestion, ResolutionCheck as Resolution, ReviewContext, ReviewResponse, ReviewRecord } from "./contracts";
import type { ResumeDocument } from "../resume/entities";
import type { ReferenceMaterial } from "../material/contracts";

export type Rating = "up" | "down" | null;
export type Decision = "open" | "resolve" | "skip";
export type SuggestionEntry = { id: string; contextId: string; reviewId: string; resumeVersionId: string | null;
  content: Suggestion; rating: Rating; decision: Decision; verification?: Resolution };
type FeedbackRef = Omit<NonNullable<ReviewContext["feedback"]>[number], "suggestion">;
export type ContextRefs = Omit<ReviewContext, "feedback"> & { feedback: FeedbackRef[] };
export type Review = { id: string; contextId: string; resumeVersionId: string | null; createdAt: string;
  input: ContextRefs; status: ReviewResponse["status"]; errors: ReviewResponse["errors"];
  materialReviews: ReviewResponse["materialReviews"]; resolutionChecks: Resolution[];
  resultIds: string[]; suggestionIds: string[]; experienceRecommendations?: ReviewResponse["experienceRecommendations"];
  modules: Omit<ReviewRecord["moduleResults"], "finalReview">;
  finalErrors: ReviewResponse["errors"]; finalFailed: boolean };
export type ReviewMaterial = { id: string; reviewId: string; materialVersionId: string };
export type PreparedReview = { kind: "page" | "flow"; document: ResumeDocument; materials: ReferenceMaterial[]; reviewContext: ReviewContext };
export type PendingRun = { runId: string; contextId: string; input: ContextRefs };

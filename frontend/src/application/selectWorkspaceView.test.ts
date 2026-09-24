import { expect, it } from "vitest";
import { emptyWorkspace, type Review, type SuggestionEntry } from "../domain/workspace/index";
import { resumeInput, suggestion } from "../test/fixtures";
import { selectWorkspaceView } from "./selectWorkspaceView";

function workspaceWithReview() {
  const workspace = emptyWorkspace();
  workspace.contexts.push({ id: "context", name: "지원", createdAt: "now", latestVersionId: "resume", latestReviewId: "review", lastAttemptId: "review", userFeedback: "" });
  workspace.resumeVersions.push({ ...resumeInput(), id: "resume", contextId: "context", version: 1, createdAt: "now", status: "ready" });
  const review: Review = { id: "review", contextId: "context", resumeVersionId: "resume", createdAt: "now", input: { contextId: "context", resumeVersionId: "resume", feedback: [] }, status: "partial", errors: [], materialReviews: [], resolutionChecks: [], resultIds: [], suggestionIds: [], modules: { spellCheck: { moduleKey: "spellCheck", output: [], errors: [] } }, finalErrors: [], finalFailed: false };
  workspace.reviews.push(review);
  return { workspace, review };
}

it("does not fall back to current results when a selected historical review no longer exists", () => {
  const { workspace } = workspaceWithReview();
  const view = selectWorkspaceView(workspace, { page: "context", contextId: "context" }, "removed-review");
  expect(view.currentReview?.id).toBe("review");
  expect(view.resume?.id).toBe("resume");
  expect(view.attempt).toBeUndefined();
  expect(view.displayReview).toBeUndefined();
  expect(view.viewedResume).toBeUndefined();
  expect(view.suggestions).toEqual([]);
});

it("includes each known retryable module once and ignores unknown and nonretryable modules", () => {
  const { workspace, review } = workspaceWithReview();
  review.errors = ["finalReview", "unknownFutureModule", "finalReview"].map(moduleKey => ({ moduleKey, inputSourceId: null, errorCode: "ERROR", userMessage: "오류", canRetry: true }));
  review.errors.push({ moduleKey: "spellCheck", inputSourceId: null, errorCode: "ERROR", userMessage: "오류", canRetry: false });
  expect(selectWorkspaceView(workspace, { page: "context", contextId: "context" }, "").retryModules).toEqual(["finalReview"]);
});

it("preserves review ordering, omits skipped or missing entries, and counts only open current suggestions", () => {
  const { workspace, review } = workspaceWithReview();
  const entries: SuggestionEntry[] = (["open", "skip", "resolve"] as const).map(decision => ({ id: decision, contextId: "context", reviewId: "review", resumeVersionId: "resume", content: suggestion(), rating: null, decision }));
  workspace.suggestions.push(...entries);
  review.suggestionIds = ["resolve", "missing", "skip", "open"];
  const view = selectWorkspaceView(workspace, { page: "context", contextId: "context" }, "");
  expect(view.suggestions.map(entry => entry.id)).toEqual(["resolve", "open"]);
  expect(view.unhandledCount).toBe(1);
  expect(review.suggestionIds).toEqual(["resolve", "missing", "skip", "open"]);
});

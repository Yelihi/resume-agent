import type { WorkspaceRoute } from "./navigation";
import type { RetryModule } from "../domain/review/ports";
import type { Workspace } from "../domain/workspace/entities";

const retryModuleKeys: readonly RetryModule[] = ["spellCheck", "jobPostingAnalysis", "companyContextAnalysis", "finalReview"];
export const retryModuleLabels: Record<RetryModule, string> = { spellCheck: "기본 검토", jobPostingAnalysis: "채용 공고", companyContextAnalysis: "회사 자료", finalReview: "최종 검토" };

export function selectWorkspaceView(workspace: Workspace, route: WorkspaceRoute, historyId: string) {
  const isNew = route.page === "new";
  const contextId = route.contextId;
  const context = workspace.contexts.find(candidate => candidate.id === contextId);
  const resume = workspace.resumeVersions.find(version => version.id === context?.latestVersionId);
  const currentReview = workspace.reviews.find(review => review.id === context?.latestReviewId);
  const attempt = workspace.reviews.find(review => review.id === (historyId || context?.lastAttemptId));
  const displayReview = historyId ? workspace.reviews.find(review => review.id === historyId) : currentReview;
  const viewedResume = historyId ? workspace.resumeVersions.find(version => version.id === displayReview?.resumeVersionId) : resume;
  const suggestionsById = new Map(workspace.suggestions.map(suggestion => [suggestion.id, suggestion]));
  const suggestions = (displayReview?.suggestionIds ?? []).flatMap(id => {
    const suggestion = suggestionsById.get(id);
    return suggestion && suggestion.decision !== "skip" ? [suggestion] : [];
  });
  return { contextId, context, resume, currentReview, attempt, displayReview, viewedResume, suggestions,
    isNew, isUpload: !!context && route.page === "upload", isLibrary: route.page === "materials",
    runningHere: workspace.activeRun?.contextId === contextId && !!workspace.activeRun,
    unhandledCount: (currentReview?.suggestionIds ?? []).filter(id => suggestionsById.get(id)?.decision === "open").length,
    links: workspace.contextMaterials.filter(link => link.contextId === contextId),
    materials: workspace.materials.filter(material => !material.deleted),
    retryModules: retryModuleKeys.filter(moduleKey => attempt?.errors.some(error => error.canRetry && error.moduleKey === moduleKey)),
  };
}

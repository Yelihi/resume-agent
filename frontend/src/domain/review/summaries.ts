import type { MaterialVersion } from "../material/entities";
import type { Review } from "./entities";

/** Join by the review's immutable version IDs, never the current library version. */
export function selectMaterialSummaries(review: Review, materialVersions: MaterialVersion[]) {
  return (["jobPostingAnalysis", "companyContextAnalysis"] as const).flatMap(moduleKey => {
    const analysis = review.modules[moduleKey]?.output;
    const isJobPosting = moduleKey === "jobPostingAnalysis";
    const materialType = isJobPosting ? "jobPosting" : "company";
    if (!analysis && !review.materialReviews.some(material => material.materialType === materialType)) return [];
    const sources = Object.entries(review.input.materialVersions ?? {}).flatMap(([sourceId, versionId]) => {
      const material = materialVersions.find(version => version.id === versionId);
      if (!material || material.materialType !== materialType) return [];
      return [{ sourceId, title: material.title, source: material.source,
        summary: analysis?.materialSummaries?.find(summary => summary.sourceId === sourceId)?.summary,
        reflection: review.materialReviews.find(reflection => reflection.sourceId === sourceId) }];
    });
    return [{ moduleKey, label: isJobPosting ? "공고 자료별 요약" : "회사 자료별 요약",
      title: isJobPosting ? "채용 공고 요약 및 반영" : "회사 자료 요약 및 반영", summary: analysis?.summary, sources }];
  });
}

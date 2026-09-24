import type { PreparedReview } from "../domain/review/entities";
import type { ResumeInput } from "../domain/resume/entities";
import type { MaterialDraft } from "../domain/material/entities";
import type { ReviewRecord, ReviewResponse } from "../domain/review/contracts";

export function resumeInput(text = "경력 한 줄"): ResumeInput {
  return { inputType: "text", displayName: "이력서", original: text, documentKind: "flow",
    document: { text, blocks: [{ blockId: "f-b1", lines: [{ lineId: "f-l1", text, startOffset: 0, endOffset: text.length }] }] } };
}
export const materialDraft = (content = "React 경험"): MaterialDraft => ({ title: "채용 자료", materialType: "jobPosting", content, source: "직접 입력" });
export const suggestion = (): ReviewResponse["results"][number] => ({ id: crypto.randomUUID(), previousSuggestionId: null,
  수정포인트위치: { lineIds: ["f-l1"], quote: "경력 한 줄" }, 수정성격: "근거", 검토출처: ["기본 검토"], 검토자료근거: [],
  "이유 및 제안": "본인의 역할을 구체적으로 작성하세요.", "실제 수정 예시": "[확인 필요: 본인의 역할]을 담당했습니다." });
export function reviewRecord(input: PreparedReview, results = [suggestion()]): ReviewRecord {
  return { runId: crypto.randomUUID(), createdAt: new Date().toISOString(), document: input.document,
    materials: input.materials, reviewContext: input.reviewContext,
    moduleResults: { spellCheck: { moduleKey: "spellCheck", output: [], errors: [] },
      finalReview: { moduleKey: "finalReview", output: { materialReviews: [], experienceRecommendations: [], results, resolutionChecks: [] }, errors: [] },
      ...(input.materials.some(m => m.materialType === "jobPosting") ? { jobPostingAnalysis: { moduleKey: "jobPostingAnalysis", output: { summary: "채용 분석", evidence: [] }, errors: [] } } : {}),
      ...(input.materials.some(m => m.materialType === "company") ? { companyContextAnalysis: { moduleKey: "companyContextAnalysis", output: { summary: "회사 분석", evidence: [] }, errors: [] } } : {}) },
    response: { status: "success", errors: [], materialReviews: [], experienceRecommendations: [], results, resolutionChecks: [] } };
}

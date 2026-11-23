import { useState } from "react";
import { SuggestionCard } from "./SuggestionCard";
import { FeedbackPanel } from "./FeedbackPanel";
import { selectMaterialSummaries } from "../../domain/review/summaries";
import { WarningCircle } from "@phosphor-icons/react";
import type { MaterialVersion } from "../../domain/material/entities";
import type { Review, SuggestionEntry } from "../../domain/review/entities";

export type SuggestionChange = Partial<Pick<SuggestionEntry, "rating" | "decision">>;
export type SuggestionActions = {
  onSuggestionChange: (suggestion: SuggestionEntry, change: SuggestionChange) => void;
  onSelectQuote: (lineIds: string[], suggestionNumber: number) => void;
};
export type ReviewResultsProps = SuggestionActions & {
  suggestions: SuggestionEntry[];
  attempt?: Review;
  displayReview?: Review;
  currentReview?: Review;
  resumeVersionId?: string;
  viewedResumeVersionId?: string;
  materialVersions: MaterialVersion[];
  historical: boolean;
  locked: boolean;
  running: boolean;
  progress: string;
  delayed: boolean;
  connectionFailed: boolean;
  initialFeedback: string;
  onFeedbackSave: (feedback: string) => void;
};
export function ReviewResults({
  suggestions, attempt, displayReview, currentReview, resumeVersionId, viewedResumeVersionId,
  materialVersions, historical, locked, running, progress, delayed, connectionFailed,
  initialFeedback, onFeedbackSave, onSuggestionChange, onSelectQuote,
}: ReviewResultsProps) {
  const [filter, setFilter] = useState("전체");
  const hasStyles = suggestions.some(item => item.content.diagnostic?.category === "writing-style");
  const visible = suggestions.map((item, index) => ({ item, number: index + 1 }))
    .filter(({ item }) => !hasStyles || filter === "전체" || (filter === "문체") === !!item.content.diagnostic);
  const evidenceReview = displayReview ?? attempt;
  return (
    <section className="results-panel" aria-label="분석 결과"><div className="results-header"><h2>분석 제안 <span className="desk-count">{visible.length}</span></h2>{attempt?.status === "success" && <span className="desk-status" role="status">검토 완료</span>}</div>
      {running && progress && <p className="review-progress" role="status">{delayed ? "검토가 예상보다 오래 걸리고 있습니다." : progress}</p>}
      {running && !connectionFailed ? <ReviewSkeleton /> : <>
        {!displayReview && !attempt && <p className="panel-empty">검토를 시작하면 수정이 필요한 제안만 이곳에 표시됩니다.</p>}
        {attempt && attempt.status !== "success" && <p className="review-summary">{attempt.status === "failed" ? "검토를 완료하지 못했습니다. 기존 제안은 유지됩니다." : attempt.status === "partial" ? "일부 항목을 확인하지 못했습니다." : "검토가 완료되었습니다."}</p>}
        {!historical && currentReview && currentReview.resumeVersionId !== resumeVersionId && <p className="notice">이전 버전의 제안입니다. 새 원문에서의 반영 여부는 다음 검토에서 확인합니다.</p>}
        {!!attempt?.errors.length && <div className="review-errors" role="group" aria-label="검토 오류"><h3>확인할 오류</h3><ul>{[...new Set(attempt.errors.map(item => item.userMessage))].map(message => <li key={message}><WarningCircle size={18} /><span>{message}</span></li>)}</ul></div>}
        {displayReview && !suggestions.length && <p className="panel-empty">현재 표시할 수정 제안이 없습니다.</p>}
        {hasStyles && <div className="desk-filter" role="group" aria-label="제안 필터">{["전체", "내용·근거", "문체"].map(value =>
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div>}
        {hasStyles && !visible.length && <p>이 분류에 해당하는 제안이 없습니다.</p>}
        <div className="suggestion-list">{visible.map(({ item, number }) => <SuggestionCard key={item.id} item={item} number={number} locked={locked || historical} viewedResumeVersionId={viewedResumeVersionId} onSuggestionChange={onSuggestionChange} onSelectQuote={onSelectQuote} />)}</div>
        {evidenceReview && <MaterialReviewSummary review={evidenceReview} materialVersions={materialVersions} />}
      </>}
      <FeedbackPanel key={initialFeedback} initialFeedback={initialFeedback} locked={locked} hidden={historical || (running && !connectionFailed)} onSave={onFeedbackSave} />
    </section>
  );
}

function ReviewSkeleton() { return <div className="review-skeleton" role="group" aria-label="분석 제안 생성 중" aria-busy="true">{[0,1,2].map(i => <div className="skeleton-card" key={i} aria-hidden="true"><span className="skeleton-line is-short" /><span className="skeleton-line" /><span className="skeleton-block" /></div>)}</div>; }

function MaterialReviewSummary({ review, materialVersions }: { review: Review; materialVersions: MaterialVersion[] }) {
  return <>{selectMaterialSummaries(review, materialVersions).map(group => (
    <div className="material-review-summary" role="group" key={group.moduleKey} aria-label={group.label}>
      <h3>{group.title}</h3>
      {group.summary && <details className="desk-source-details"><summary>전체 자료 요약</summary><p>{group.summary}</p></details>}
      {group.sources.map(source => {
        const rows = review.requirementAssessments?.filter(row => row.sourceId === source.sourceId) ?? [];
        return <section className="material-source-summary" key={source.sourceId}>
          <h4>{source.title}</h4>
          {!!rows.length && <section aria-label={source.title + " 요구사항별 근거"}><ul className="desk-requirements">
            {rows.map(row => <li key={row.requirement}>
              <div><strong>{row.requirement}</strong><span className="desk-tag" data-status={row.status}>{{ matched: "맞음", partial: "부분 충족", unconfirmed: "자료에서 확인되지 않음" }[row.status]}</span></div>
              <p>{row.reason}</p>
              {row.resumeEvidence.map((e, i) => <blockquote key={i}><small>이력서</small>{e.quote}</blockquote>)}
              {row.experienceEvidence.map((e, i) => <blockquote key={i}><small>{review.input.experiences?.find(x => x.id === e.experienceId)?.title ?? "경험"} · 버전 {e.revision}</small>{e.quote}</blockquote>)}
            </li>)}
          </ul></section>}
          <details className="desk-source-details" open={rows.length ? undefined : true}>
            <summary>자료 요약 및 반영 내용</summary>
            <small className="source-text">{source.source}</small>
            <p>{source.summary ?? "저장된 짧은 요약이 없습니다. 다음 검토부터 생성됩니다."}</p>
            {source.reflection && <p><strong>{source.reflection.status === "applied" ? "반영" : "미반영"}</strong> · {source.reflection.reason}</p>}
          </details>
        </section>;
      })}
    </div>
  ))}</>;
}

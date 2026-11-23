import { ArrowUpLeft, ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import type { SuggestionEntry } from "../../domain/review/entities";
import type { SuggestionActions } from "./ReviewResults";

type SuggestionCardProps = SuggestionActions & {
  item: SuggestionEntry;
  number: number;
  locked: boolean;
  viewedResumeVersionId?: string;
};

export function SuggestionCard({ item, number, locked, viewedResumeVersionId, onSuggestionChange, onSelectQuote }: SuggestionCardProps) {
  const suggestion = item.content;
  const ask = suggestion.diagnostic?.action === "ask";
  const quote = suggestion.수정포인트위치;
  return (
    <article>
      <div className="suggestion-title"><span className="suggestion-index">{number}</span><h3>{suggestion.diagnostic?.category === "writing-style" ? "문체" : suggestion.수정성격}</h3>
      <div className="suggestion-sources" role="group" aria-label="검토 출처">
        {suggestion.검토출처.map(source => <span key={source}>{source}</span>)}
      </div></div>
      {item.verification && <p className="notice">{item.verification.status === "notApplied" ? "미반영" : "확인 필요"}: {item.verification.reason}</p>}
      <div className="suggestion-comparison">
        <span className="suggestion-label">기존 문장</span>
        <button disabled={item.resumeVersionId !== viewedResumeVersionId} aria-label={`${quote.quote} 제안 보기`} onClick={() => onSelectQuote(quote.lineIds, number)}><ArrowUpLeft size={15} aria-hidden="true" /><span>{quote.quote}</span></button>
        <span className="suggestion-label">{ask ? "확인할 내용" : "수정 제안"}</span><p className="suggestion-rewrite">{ask ? suggestion["이유 및 제안"] : suggestion["실제 수정 예시"]}</p>
      </div>
      {!ask && <div className="suggestion-reason"><span className="suggestion-label">수정 원인 및 방향</span><p>{suggestion["이유 및 제안"]}</p></div>}
      {suggestion.검토자료근거.map((evidence, index) => <div className="material-evidence" key={index}><span>자료에서 고려한 점</span><p>{evidence.consideredPoint}</p></div>)}
      <div className="suggestion-feedback">
        <div className="thumb-actions" role="group" aria-label={`제안 ${number} 평가`}>
          <button className="icon-button" disabled={locked} aria-label={`제안 ${number} 좋아요`} aria-pressed={item.rating === "up"} onClick={() => onSuggestionChange(item, { rating: item.rating === "up" ? null : "up" })}><ThumbsUp size={19} /></button>
          <button className="icon-button" disabled={locked} aria-label={`제안 ${number} 싫어요`} aria-pressed={item.rating === "down"} onClick={() => onSuggestionChange(item, { rating: item.rating === "down" ? null : "down" })}><ThumbsDown size={19} /></button>
        </div>
        <button disabled={locked} aria-label={`제안 ${number} Resolve`} aria-pressed={item.decision === "resolve"} onClick={() => onSuggestionChange(item, { decision: item.decision === "resolve" ? "open" : "resolve" })}>반영 확인</button>
        <button disabled={locked} aria-label={`제안 ${number} Skip`} onClick={() => onSuggestionChange(item, { decision: "skip" })}>건너뛰기</button>
      </div>
      {item.decision === "resolve" && <small className="decision-note">다음 검토에서 수정 반영 여부를 확인합니다.</small>}
    </article>
  );
}

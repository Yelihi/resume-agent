import { Plus, Trash } from "@phosphor-icons/react";
import type { InterviewQuestion } from "../../domain/experience/entities";

export function InterviewPreparation({ questions, onChange, disabled = false }: {
  questions: InterviewQuestion[];
  onChange?: (questions: InterviewQuestion[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, change: Partial<InterviewQuestion>) =>
    onChange?.(questions.map((item, i) => i === index ? { ...item, ...change } : item));
  return <section className="experience-interview" aria-labelledby="experience-interview-heading">
    <header className="experience-preparation-heading"><div><span className="experience-kicker">면접 준비</span>
      <h2 id="experience-interview-heading">예상 질문과 답변 메모 <span className="experience-question-count">{questions.length}/20</span></h2>
    </div>{onChange && <button type="button" disabled={disabled || questions.length >= 20}
      onClick={() => onChange([...questions, { question: "", answer: "", evidence: "" }])}><Plus size={16} aria-hidden="true" />질문 추가</button>}</header>
    <p className="experience-hint">이 경험과 함께 보관합니다. AI의 답변 초안을 확인하고, 본인의 설명과 근거를 보완해 주세요.</p>
    {!questions.length && <p className="experience-preparation-empty">메타데이터를 생성하면 본문에 맞는 질문과 답변 근거를 제안합니다. 질문을 직접 추가해도 좋습니다.</p>}
    <div className="experience-interview-list">{questions.map((item, index) => onChange ?
      <fieldset className="experience-interview-item" key={index} disabled={disabled}>
        <legend>질문 {index + 1}</legend>
        <label>예상 질문<textarea aria-label={`예상 질문 ${index + 1}`} value={item.question} maxLength={500} required rows={2}
          placeholder="예: 이 방법을 선택한 이유와 다른 대안은 무엇이었나요?" onChange={event => update(index, { question: event.target.value })} /></label>
        <div className="experience-answer-fields">
          <label>답변 메모 <span className="optional-label">선택</span><textarea aria-label={`답변 메모 ${index + 1}`} value={item.answer} maxLength={4000} rows={4}
            placeholder="직접 판단한 내용, 선택 이유, 검증 방법을 적어 주세요. 확인되지 않은 부분은 비워 두어도 됩니다." onChange={event => update(index, { answer: event.target.value })} /></label>
          <label>근거·확인할 내용 <span className="optional-label">선택</span><textarea aria-label={`답변 근거 ${index + 1}`} value={item.evidence} maxLength={2000} rows={4}
            placeholder="본문의 근거, 원본 링크, 더 확인해야 할 내용을 남겨 주세요." onChange={event => update(index, { evidence: event.target.value })} /></label>
        </div>
        <button type="button" className="text-button" aria-label={`질문 ${index + 1} 삭제`} onClick={() => onChange(questions.filter((_, i) => i !== index))}><Trash size={16} aria-hidden="true" />질문 삭제</button>
      </fieldset> : <details className="experience-interview-item" key={index}>
        <summary><span className="experience-question-number">{String(index + 1).padStart(2, "0")}</span>{item.question}</summary>
        <div className="experience-answer-fields"><div><h3>답변 메모</h3><p>{item.answer || "아직 답변을 작성하지 않았습니다."}</p></div>
          <div><h3>근거·확인할 내용</h3><p>{item.evidence || "근거를 확인한 뒤 보완해 주세요."}</p></div></div>
      </details>)}</div>
    {onChange && <p className="experience-hint">질문·답변은 최종 저장 시 보관됩니다. 본문을 수정했다면 기존 답변과 근거도 확인해 주세요.</p>}
  </section>;
}

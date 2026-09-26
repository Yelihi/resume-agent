import { useState } from "react";
import { Dialog } from "./Dialog";
import type { ResumeInput } from "../domain/resume/entities";
import type { ResumeProcessingStage } from "../application/useResumeWorkflow";
import { ResumeViewer } from "../viewer/ResumeViewer";
import { DocumentSkeleton } from "../viewer/DocumentSkeleton";

type ExtractionPreviewProps = {
  input: ResumeInput | null;
  processingStage?: ResumeProcessingStage | null;
  displayName?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const steps = [
  { stage: "preparing", label: "입력 확인", message: "입력 형식과 조건을 확인하고 있습니다." },
  { stage: "extracting", label: "문서 변환", message: "이력서의 글자와 문서 구조를 읽고 있습니다." },
  { stage: "ready", label: "내용 확인", message: "추출이 완료되었습니다. 원문과 추출 확인 사항을 확인한 뒤 저장해 주세요." },
  { stage: "saving", label: "저장", message: "변환한 이력서와 원본을 저장하고 있습니다." },
] as const;

export function ExtractionPreview({ input, processingStage, displayName, busy, onCancel, onConfirm }: ExtractionPreviewProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const stage = processingStage ?? (busy && input ? "saving" : input ? "ready" : "preparing");
  const activeStep = steps.findIndex(step => step.stage === stage);
  const blocked = busy || !!processingStage;
  const issues = input?.document.extraction?.issues ?? [];
  const lines = input ? "pages" in input.document ? input.document.pages.flatMap(page => page.blocks.flatMap(block => block.lines)) : input.document.blocks.flatMap(block => block.lines) : [];
  return <Dialog className="extraction-dialog" labelledBy="extraction-title" onDismiss={() => { if (!blocked) onCancel(); }}>
    <header className="drawer-header"><div><h2 id="extraction-title">추출 내용 확인</h2><p>{input?.displayName ?? displayName}</p></div>{input && <span className="extraction-complete">변환 완료</span>}</header>
    <div className="extraction-progress">
      <ol className="extraction-steps" aria-label="이력서 처리 단계">{steps.map((step, index) => <li key={step.stage} aria-current={step.stage === stage ? "step" : undefined} data-complete={index < activeStep || undefined} data-processing={step.stage === stage && blocked || undefined}><span aria-hidden="true">{index < activeStep ? "✓" : index + 1}</span>{step.label}</li>)}</ol>
      <p role="status" aria-atomic="true">{steps[activeStep].message}</p>
    </div>
    <div className="extraction-comparison" aria-busy={!input || undefined}>
      <section className="extraction-original" aria-label="비교할 원문" tabIndex={0}>
        {input ? <ResumeViewer resume={{ ...input, status: "ready" }} selectedLineIds={selectedLineIds} /> : <div aria-hidden="true"><DocumentSkeleton /></div>}
      </section>
      <section className="extraction-findings" aria-label="추출 확인 사항" tabIndex={0}>
        <h3>추출 확인 사항{input && <small> {issues.length}건</small>}</h3>
        {input ? <>
          {input.documentKind === "flow" && <p>왼쪽은 추출된 내용입니다. DOCX·TXT 원본 파일을 별도로 열어 비교해 주세요.</p>}
          {!issues.length && <p>추출 확인 사항이 없습니다. 원문과 비교해 누락된 내용이 없는지 확인해 주세요.</p>}
          {issues.map((issue, issueIndex) => <article key={issueIndex}><strong>{issue.pageNumber ? `${issue.pageNumber}페이지 · ` : ""}{issue.recovered ? "복구됨" : "확인 필요"}</strong><p>{issue.message}</p>{issue.lineIds?.map(lineId => <button type="button" key={lineId} className="text-button" aria-pressed={selectedLineIds.includes(lineId)} onClick={() => setSelectedLineIds([lineId])}>{lines.find(line => line.lineId === lineId)?.text ?? "해당 구간 보기"}</button>)}</article>)}
          <details><summary>추출문 전체 보기</summary><pre>{lines.map(line => line.text).join("\n")}</pre></details>
        </> : <>
          <p>스캔 문서나 이미지는 글자 인식에 시간이 더 걸릴 수 있습니다. 완료되면 이곳에 확인 사항을 표시합니다.</p>
          <div className="skeleton-card" aria-hidden="true"><span className="skeleton-line is-short" /><span className="skeleton-line" /><span className="skeleton-line is-medium" /></div>
        </>}
      </section>
    </div>
    <footer className="extraction-actions"><label><input type="checkbox" disabled={blocked || !input} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />원본과 비교해 검토에 사용할 수 있음을 확인했습니다.</label><div><button disabled={blocked || !input} onClick={onCancel}>취소</button><button className="button-primary" disabled={blocked || !input || !confirmed} onClick={onConfirm}>{stage === "saving" ? "저장 중" : "확인 후 저장"}</button></div></footer>
  </Dialog>;
}

import { useState } from "react";
import { Dialog } from "./Dialog";
import type { ResumeInput } from "../domain/resume/entities";
import { ResumeViewer } from "../viewer/ResumeViewer";

type ExtractionPreviewProps = {
  input: ResumeInput;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ExtractionPreview({ input, busy, onCancel, onConfirm }: ExtractionPreviewProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const issues = input.document.extraction?.issues ?? [];
  const lines = "pages" in input.document ? input.document.pages.flatMap(page => page.blocks.flatMap(block => block.lines)) : input.document.blocks.flatMap(block => block.lines);
  return <Dialog className="extraction-dialog" labelledBy="extraction-title" busy={busy} onDismiss={onCancel}>
    <header className="drawer-header"><div><h2 id="extraction-title">추출 내용 확인</h2><p>불확실한 구간이 있습니다. 원본과 비교한 뒤 저장해 주세요.</p></div></header>
    <div className="extraction-comparison">
      <section className="extraction-original" aria-label="비교할 원문"><ResumeViewer resume={{ ...input, status: "ready" }} selectedLineIds={selectedLineIds} /></section>
      <section className="extraction-findings" aria-label="추출 확인 사항">
        {input.documentKind === "flow" && <p>왼쪽은 추출된 내용입니다. DOCX·TXT 원본 파일을 별도로 열어 비교해 주세요.</p>}
        {issues.map((issue, issueIndex) => <article key={issueIndex}><strong>{issue.pageNumber ? `${issue.pageNumber}페이지 · ` : ""}{issue.recovered ? "복구됨" : "확인 필요"}</strong><p>{issue.message}</p>{issue.lineIds?.map(lineId => <button type="button" key={lineId} className="text-button" aria-pressed={selectedLineIds.includes(lineId)} onClick={() => setSelectedLineIds([lineId])}>{lines.find(line => line.lineId === lineId)?.text ?? "해당 구간 보기"}</button>)}</article>)}
        <details><summary>추출문 전체 보기</summary><pre>{lines.map(line => line.text).join("\n")}</pre></details>
      </section>
    </div>
    <footer className="extraction-actions"><label><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />원본과 비교해 검토에 사용할 수 있음을 확인했습니다.</label><div><button disabled={busy} onClick={onCancel}>취소</button><button className="button-primary" disabled={busy || !confirmed} onClick={onConfirm}>{busy ? "저장 중" : "확인 후 저장"}</button></div></footer>
  </Dialog>;
}

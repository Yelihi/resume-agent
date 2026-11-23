import { PageHeading } from "../../components/PageHeading";
import { useState } from "react";
import { ArrowLeft, UploadSimple } from "@phosphor-icons/react";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import type { ResumeDraft } from "../../application/useResumeWorkflow";

type ResumeUploadProps = { contextName?: string; isNew: boolean; draft: ResumeDraft; busy: boolean; locked: boolean;
  onChange: (change: Partial<ResumeDraft>) => void; onBack: () => void; onSave: () => void };

export function ResumeUpload({ contextName, isNew, draft, busy, locked, onChange, onBack, onSave }: ResumeUploadProps) {
  const [dragging, setDragging] = useState(false);
  return <>
    <PageHeading title={isNew ? "새 작업 공간" : `${contextName} · 수정본 업로드`}
      actions={<button className="button-secondary" disabled={busy} onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />돌아가기</button>} />
    <section className="creation-panel" aria-label="이력서 입력">
      <p>{isNew ? "이력서를 등록하면 새 작업 공간이 만들어집니다." : "같은 이력서의 수정본을 올리면 다음 버전으로 저장됩니다."}</p>
      {isNew && <label>작업 공간 이름<input aria-label="작업 공간 이름" value={draft.contextName} disabled={locked} onChange={event => onChange({ contextName: event.target.value })} placeholder="예: 프런트엔드 개발자 지원" /></label>}
      <SegmentedTabs id="resume-input" label="이력서 입력 방식" value={draft.inputMode} options={[{ value: "file", label: "파일" }, { value: "text", label: "직접 입력" }]} disabled={locked} onChange={inputMode => onChange({ inputMode })} />
      <div role="tabpanel" id="resume-input-panel" aria-labelledby={`resume-input-${draft.inputMode}`}>
        {draft.inputMode === "file" ? <label className={`upload-area${dragging && !locked ? " is-dragging" : ""}`}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = locked ? "none" : "copy"; if (!locked) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); if (!locked && event.dataTransfer.files[0]) onChange({ file: event.dataTransfer.files[0] }); }}>
          <UploadSimple size={28} aria-hidden="true" /><span aria-live="polite">{draft.file?.name ?? "이력서 파일을 선택하거나 끌어다 놓으세요"}</span>
          {draft.file && <span className="upload-hint">다른 파일 선택</span>}<small>PDF · 이미지 · DOCX · TXT</small>
          <input aria-label="이력서 파일" type="file" disabled={locked} accept=".pdf,.png,.jpg,.jpeg,.gif,.tif,.tiff,.webp,.docx,.txt" onChange={event => { if (event.target.files?.[0]) onChange({ file: event.target.files[0] }); }} />
        </label> : <label>이력서 텍스트<textarea aria-label="이력서 텍스트" disabled={locked} value={draft.text} onChange={event => onChange({ text: event.target.value })} rows={12} /></label>}
      </div>
      <button className="button-primary" disabled={locked || (isNew && !draft.contextName.trim())} onClick={onSave}>{busy ? "변환·저장 중" : isNew ? "작업 공간 만들기" : "수정본 저장"}</button>
    </section>
  </>;
}

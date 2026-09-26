import { useState } from "react";
import { ArrowLeft, UploadSimple } from "@phosphor-icons/react";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Dialog } from "../../components/Dialog";
import { DocumentSkeleton } from "../../viewer/DocumentSkeleton";
import type { ResumeDraft, ResumeProcessingStage } from "../../application/useResumeWorkflow";

type ResumeUploadProps = { contextName?: string; isNew: boolean; draft: ResumeDraft; busy: boolean; locked: boolean;
  processingStage: ResumeProcessingStage | null;
  onChange: (change: Partial<ResumeDraft>) => void; onBack: () => void; onSave: () => void };

const processingSteps = [
  { stage: "preparing", label: "입력 확인", message: "파일 형식과 입력 조건을 확인하고 있습니다." },
  { stage: "extracting", label: "문서 변환", message: "이력서의 글자와 문서 구조를 읽고 있습니다." },
  { stage: "saving", label: "저장", message: "변환한 이력서와 원본을 저장하고 있습니다." },
] as const;

export function ResumeUpload({ contextName, isNew, draft, busy, locked, processingStage, onChange, onBack, onSave }: ResumeUploadProps) {
  const [dragging, setDragging] = useState(false);
  const activeStep = processingSteps.findIndex(step => step.stage === processingStage);
  return <>
    <header className="topbar"><div><span className="eyebrow">{isNew ? "NEW CONTEXT" : "NEXT VERSION"}</span><h1>{isNew ? "새 작업 공간" : `${contextName} · 수정본 업로드`}</h1></div><button className="button-secondary" disabled={busy} onClick={onBack}><ArrowLeft size={17} />돌아가기</button></header>
    <section className="creation-panel" aria-label="이력서 입력">
      <p>{isNew ? "새 이력서는 이전 검토와 피드백을 공유하지 않는 독립된 작업 공간에 저장됩니다." : "이 파일은 현재 작업 공간의 다음 버전으로 저장됩니다. 같은 이력서의 수정본인지 직접 확인해 주세요. 파일 형식은 달라도 됩니다."}</p>
      {isNew && <label>작업 공간 이름<input aria-label="작업 공간 이름" value={draft.contextName} disabled={locked} onChange={event => onChange({ contextName: event.target.value })} placeholder="예: 프런트엔드 개발자 지원" /></label>}
      <SegmentedTabs id="resume-input" label="이력서 입력 방식" value={draft.inputMode} options={[{ value: "file", label: "파일" }, { value: "text", label: "직접 입력" }]} disabled={locked} onChange={inputMode => onChange({ inputMode })} />
      <div role="tabpanel" id="resume-input-panel" aria-labelledby={`resume-input-${draft.inputMode}`}>
        {draft.inputMode === "file" ? <label className={`upload-area${dragging && !locked ? " is-dragging" : ""}`}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = locked ? "none" : "copy"; if (!locked) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); if (!locked && event.dataTransfer.files[0]) onChange({ file: event.dataTransfer.files[0] }); }}>
          <UploadSimple size={28} aria-hidden="true" /><span aria-live="polite">{draft.file?.name ?? "이력서를 여기에 끌어다 놓으세요"}</span>
          <span className="upload-hint">{draft.file ? "다른 파일을 놓거나 클릭해서 변경" : "또는 클릭해서 파일 선택"}</span><small>PDF · 이미지 · DOCX · TXT</small>
          <input aria-label="이력서 파일" type="file" disabled={locked} accept=".pdf,.png,.jpg,.jpeg,.gif,.tif,.tiff,.webp,.docx,.txt" onChange={event => { if (event.target.files?.[0]) onChange({ file: event.target.files[0] }); }} />
        </label> : <label>이력서 텍스트<textarea aria-label="이력서 텍스트" disabled={locked} value={draft.text} onChange={event => onChange({ text: event.target.value })} rows={12} /></label>}
      </div>
      <button className="button-primary" disabled={locked || (isNew && !draft.contextName.trim())} onClick={onSave}>{busy ? "변환·저장 중" : isNew ? "작업 공간 만들기" : "수정본 저장"}</button>
    </section>
    {processingStage && <Dialog className="extraction-dialog resume-processing-dialog" labelledBy="resume-processing-title" onDismiss={() => {}}>
      <header className="drawer-header"><div><h2 id="resume-processing-title">이력서를 준비하고 있습니다</h2><p>{draft.inputMode === "file" ? draft.file?.name : "직접 입력 이력서"}</p></div></header>
      <div className="resume-processing-content">
        <ol className="resume-processing-steps" aria-label="이력서 처리 단계">{processingSteps.map((step, index) => <li key={step.stage} aria-current={step.stage === processingStage ? "step" : undefined} data-complete={index < activeStep || undefined}><span aria-hidden="true">{index < activeStep ? "✓" : index + 1}</span>{step.label}</li>)}</ol>
        <p role="status" aria-atomic="true">{processingSteps[activeStep].message}</p>
        <p className="resume-processing-hint">스캔 문서나 이미지는 글자 인식에 시간이 더 걸릴 수 있습니다. 변환 후 확인이 필요한 내용이 있으면 먼저 보여드립니다.</p>
        <div aria-hidden="true"><DocumentSkeleton /></div>
      </div>
    </Dialog>}
  </>;
}

import { Paperclip } from "@phosphor-icons/react";
import { useRef } from "react";
import { Dialog } from "../../components/Dialog";
import { OriginalDownload } from "../../components/OriginalDownload";
import type { MaterialEditorDraft } from "../../application/useMaterialsWorkflow";

export type MaterialEditorProps = {
  editor: MaterialEditorDraft;
  updateEditor: (change: Partial<MaterialEditorDraft>) => void;
  onCancel: () => void;
  onExtract: () => void;
  onSave: () => void;
  busy: boolean;
};

export function MaterialEditor({ editor, updateEditor, onCancel, onExtract, onSave, busy }: MaterialEditorProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  return <Dialog className="material-editor" label="자료 미리보기" onDismiss={onCancel} busy={busy} initialFocusRef={titleRef}>
    <div className="panel-heading"><div><span className="eyebrow">{editor.materialId ? "NEW MATERIAL VERSION" : "MATERIAL DRAFT"}</span><h2>{editor.materialId ? "자료 수정" : "새 자료 등록"}</h2></div><button disabled={busy} className="text-button" onClick={onCancel}>편집 취소</button></div>
    <p>추출 내용을 확인하고 수정한 뒤 저장하세요. 저장 전 내용은 검토에 사용되지 않습니다.</p>
    <label>자료 제목<input ref={titleRef} aria-label="자료 제목" disabled={busy} value={editor.title} onChange={event => updateEditor({ title: event.target.value })} /></label>
    <label>자료 종류<select aria-label="자료 종류" disabled={busy || !!editor.materialId} value={editor.materialType} onChange={event => updateEditor({ materialType: event.target.value === "company" ? "company" : "jobPosting" })}><option value="jobPosting">채용 공고</option><option value="company">회사 자료</option></select></label>
    {!editor.previewed ? <>
      <label>자료 입력<textarea placeholder="내용 또는 URL" aria-label="자료 입력" disabled={busy} value={editor.input} onChange={event => updateEditor({ input: event.target.value, file: undefined, original: undefined })} rows={6} /></label>
      <label className="file-picker"><Paperclip size={18} aria-hidden="true" />{editor.file?.name ?? "자료 파일 선택"}<input className="visually-hidden" type="file" aria-label="자료 파일" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) updateEditor({ file, title: editor.title || file.name }); }} /></label>
      <button className="button-primary" disabled={busy || (!editor.input.trim() && !editor.file)} onClick={onExtract}>{busy ? "자료 확인 중" : "추출 내용 확인"}</button>
    </> : <>
      <label>추출 내용<textarea aria-label="추출 내용" disabled={busy} value={editor.content} onChange={event => updateEditor({ content: event.target.value })} rows={12} /></label>
      <p className="source-text">출처: {editor.source}</p>
      <OriginalDownload original={editor.file ?? editor.original} name={editor.source} />
      <div className="card-actions"><button className="button-secondary" disabled={busy} onClick={() => updateEditor({ previewed: false, input: editor.source.startsWith("http") ? editor.source : editor.content })}>{editor.source.startsWith("http") ? "다시 가져오기" : "입력 다시 선택"}</button><button className="button-primary" disabled={busy || !editor.title.trim() || !editor.content.trim()} onClick={onSave}>자료 저장</button></div>
    </>}
  </Dialog>;
}

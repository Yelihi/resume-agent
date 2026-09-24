import { Paperclip, ArrowLeft, ArrowRight, FileText, Link, CheckCircle, WarningCircle, Sparkle, Code, Eye } from "@phosphor-icons/react";
import type { ApplicationController } from "../../application/useApplication";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { ExperienceSources } from "./ExperienceSources";
import { MarkdownDocument } from "./MarkdownDocument";
import "./experience-authoring.css";

function GenerationLoading({ message, kind }: { message: string; kind: "draft" | "metadata" }) {
  return <div className={`experience-generation is-${kind}`}>
    <p className="review-progress experience-generation-status" role="status" aria-live="polite" aria-atomic="true"><Sparkle size={16} aria-hidden="true" /><span key={message}>{message}</span></p>
    <div className="experience-generation-skeleton" aria-hidden="true">{Array.from({ length: kind === "draft" ? 4 : 2 }, (_, index) => <div className="document-skeleton-section" key={index}><span className="skeleton-line is-short" /><span className="skeleton-line" /><span className="skeleton-line is-medium" /></div>)}</div>
  </div>;
}

export function ExperienceEditor({ application }: { application: ApplicationController }) {
  const { experiencesWorkflow: workflow, task } = application;
  const editor = workflow.editor;
  const generation = workflow.generation;
  if (!editor) return null;
  const metadataReady = editor.metadataFor === editor.markdown && !!editor.metadata.trim();
  return <form className="experience-authoring" onSubmit={event => { event.preventDefault(); void workflow.saveExperience(); }}>
    <header className="topbar"><div><h1>{editor.experienceId ? "경험 수정" : "경험 작성"}</h1><p>문제를 발견하고 해결하기까지, 나의 판단과 변화를 기록하세요.</p></div><button type="button" disabled={task.busy} onClick={workflow.cancelEditor}><ArrowLeft size={16} />목록으로</button></header>
    <div className="experience-authoring-body">
      <section className="experience-authoring-document" aria-label="경험 작성">
        <div className="experience-fields"><label>제목<input value={editor.title} disabled={task.busy} maxLength={500} placeholder="예: 결제 중복 요청 개선" onChange={event => workflow.updateEditor({ title: event.target.value })} /></label>
          <label>경험 기간 <span className="optional-label">선택</span><input value={editor.period} disabled={task.busy} maxLength={200} placeholder="예: 2026.08–진행 중" onChange={event => workflow.updateEditor({ period: event.target.value })} /></label></div>
        <ol className="experience-story-guide" aria-label="경험 작성 흐름">{["문제", "분석", "해결", "기대 결과"].map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span>{step}{index < 3 && <ArrowRight size={14} aria-hidden="true" />}</li>)}</ol>
        <div className="experience-editor-surface">
          <div className="experience-authoring-toolbar"><SegmentedTabs id="experience-content" label="본문 보기 방식" value={editor.preview ? "preview" : "markdown"} options={[{ value: "markdown", label: <><Code size={16} aria-hidden="true" />Markdown</> }, { value: "preview", label: <><Eye size={16} aria-hidden="true" />Preview</> }]} disabled={task.busy} onChange={value => workflow.updateEditor({ preview: value === "preview" })} /><span className="experience-word-count">{editor.markdown.length.toLocaleString("ko-KR")}자</span></div>
          <div id="experience-content-panel" role="tabpanel" aria-labelledby={`experience-content-${editor.preview ? "preview" : "markdown"}`} tabIndex={0}>
            {generation?.kind === "draft" ? <GenerationLoading {...generation} /> : editor.preview ? <div className="experience-authoring-preview">{editor.markdown.trim() ? <MarkdownDocument markdown={editor.markdown} /> : <p className="experience-preview-empty">Markdown 탭에서 작성한 내용이 여기에 표시됩니다.</p>}</div> : <label className="experience-markdown-label"><span className="visually-hidden">경험 Markdown 편집</span><textarea className="experience-authoring-markdown" value={editor.markdown} disabled={task.busy} maxLength={60_000} spellCheck={false} onChange={event => workflow.updateEditor({ markdown: event.target.value })} placeholder={"## 문제\n어떤 상황에서 무엇을 해결해야 했나요?\n\n## 분석\n원인과 제약은 무엇이고, 어떤 대안을 비교했나요?\n\n## 해결\n내 역할은 무엇이며, 어떤 판단으로 실행했나요?\n\n## 기대 결과\n무엇이 달라지길 기대했고, 어떻게 확인할 계획인가요?\n\n## 실제 결과와 근거\n확인된 변화만 적고, 아직 측정하지 않았다면 구분해 주세요."} rows={24} /></label>}
          </div>
        </div>
        <p className="experience-hint">이미지는 ![설명](https://…) 형식의 외부 URL로 넣을 수 있습니다.</p>
        {!!editor.questions.length && <section className="experience-authoring-questions"><h2>보완하면 좋은 내용</h2><ul>{editor.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></section>}
        <section className="experience-authoring-metadata"><div className="experience-metadata-heading"><div><h2>추천용 메타데이터</h2><p className="experience-hint">문제 → 분석 → 해결 → 기대 결과를 연결하고, 실제 성과와 근거를 따로 정리합니다.</p></div><button type="button" disabled={task.busy || !editor.markdown.trim()} onClick={() => void workflow.generateMetadata()}><Sparkle size={16} aria-hidden="true" />메타데이터 생성</button></div>{generation?.kind === "metadata" ? <GenerationLoading {...generation} /> : editor.metadata || editor.metadataFor ? <><label><span className="visually-hidden">추천용 메타데이터</span><textarea value={editor.metadata} disabled={task.busy} maxLength={12_000} rows={8} onChange={event => workflow.updateEditor({ metadata: event.target.value })} /></label><p className="experience-hint">사실과 다른 부분은 직접 고쳐 주세요.</p>{!metadataReady && <p role="status" className="experience-hint">경험이 변경되었습니다. 메타데이터를 다시 생성해 주세요.</p>}</> : <p className="experience-hint">본문을 작성한 뒤 생성해 주세요. 저장한 메타데이터는 AI가 경험을 추천할 때 사용합니다.</p>}</section>
      </section>
      <aside className="experience-authoring-materials" aria-label="참고 자료"><h2>참고 자료</h2><p>링크와 문서에서 경험 초안을 만들 수 있습니다. 생성된 본문은 자유롭게 수정하세요.</p>
        <label>관련 링크<textarea className="experience-links" value={editor.links} disabled={task.busy} onChange={event => workflow.updateEditor({ links: event.target.value })} placeholder="GitHub, 작업 문서 등의 링크를 한 줄에 하나씩" rows={4} /></label>
        <label className="file-picker"><Paperclip size={18} aria-hidden="true" />문서 첨부<input type="file" className="visually-hidden" multiple disabled={task.busy} accept=".pdf,.docx,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.html,.css,.sql,.yml,.yaml,.xml,.log" aria-label="경험 파일 첨부" onChange={event => { workflow.updateEditor({ files: [...editor.files, ...Array.from(event.target.files ?? [])] }); event.target.value = ""; }} /></label>
        {!!editor.files.length && <ul className="experience-file-list">{editor.files.map((file, index) => <li key={`${index}-${file.name}`}><span>{file.name}</span><button type="button" className="text-button" disabled={task.busy} aria-label={`${file.name} 첨부 취소`} onClick={() => workflow.updateEditor({ files: editor.files.filter((_, i) => i !== index) })}>제거</button></li>)}</ul>}
        <p className="experience-hint">텍스트·코드 파일, PDF, DOCX를 첨부할 수 있습니다. 이미지는 외부 URL을 사용해 주세요.</p>
        <button type="button" className="experience-transform" disabled={task.busy || (!editor.markdown.trim() && !editor.links.trim() && !editor.files.length && !editor.sources.length)} onClick={() => void workflow.transformExperience()}><Sparkle size={16} aria-hidden="true" />자료로 초안 작성</button>
        {!!editor.sources.length && <section className="experience-authoring-source-notes"><h3>참고한 자료 <span>{editor.sources.length}</span></h3><ul className="experience-source-list" aria-label="참고한 자료">{editor.sources.map(source => {
          const note = editor.sourceNotes.find(item => item.sourceId === source.id);
          const needsCheck = source.kind === "link" && note?.verified === false;
          const verified = source.kind !== "link" || note?.verified === true;
          return <li key={source.id} data-needs-check={needsCheck}><span className="experience-source-icon">{source.kind === "link" ? <Link size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}</span><div><strong>{source.name || source.url || "첨부 자료"}</strong><span className="experience-source-status">{verified ? <CheckCircle size={14} aria-hidden="true" /> : <WarningCircle size={14} aria-hidden="true" />}{source.kind !== "link" ? "본문 추출 완료" : note?.verified ? "내용 확인 완료" : needsCheck ? "내용 확인 필요" : "보관한 링크"}</span></div></li>;
        })}</ul>{editor.sourceNotes.some(note => !note.verified) && <p className="experience-hint">확인하지 못한 자료는 관련 내용을 본문이나 문서로 보완해 주세요.</p>}</section>}
        {!!editor.sources.length && <details className="experience-attached-sources"><summary>보관한 원본 {editor.sources.length}개</summary><ExperienceSources sources={editor.sources} /></details>}
      </aside>
    </div>
    <footer className="experience-authoring-footer"><p role="status">{task.busy ? "경험을 처리하고 있습니다…" : metadataReady ? "내용과 메타데이터를 확인한 뒤 최종 저장하세요." : "추천용 메타데이터를 생성한 뒤 저장할 수 있습니다."}</p><button className="button-primary" disabled={task.busy || !editor.markdown.trim() || !metadataReady}>최종 저장<ArrowRight size={16} aria-hidden="true" /></button></footer>
  </form>;
}

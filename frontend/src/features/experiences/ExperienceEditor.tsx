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
    <header className="topbar"><div><h1>{editor.experienceId ? "경험 수정" : "경험 작성"}</h1><p>활동과 기여를 기록하고, 자료에 맞는 형식으로 경험을 정리하세요.</p></div><button type="button" disabled={task.busy} onClick={workflow.cancelEditor}><ArrowLeft size={16} />목록으로</button></header>
    <div className="experience-authoring-body">
      <section className="experience-authoring-document" aria-label="경험 작성">
        <div className="experience-fields"><label>제목<input value={editor.title} disabled={task.busy} maxLength={500} placeholder="예: 결제 중복 요청 개선" onChange={event => workflow.updateEditor({ title: event.target.value })} /></label>
          <label>경험 기간 <span className="optional-label">선택</span><input value={editor.period} disabled={task.busy} maxLength={200} placeholder="예: 2026.08–진행 중" onChange={event => workflow.updateEditor({ period: event.target.value })} /></label></div>
        <div className="experience-template-option">
          <label className="experience-template-toggle"><input type="checkbox" role="switch" checked={editor.useTemplate} disabled={task.busy} aria-describedby="experience-template-help" onChange={event => workflow.updateEditor({ useTemplate: event.target.checked })} />추천 템플릿 사용</label>
          <p id="experience-template-help" className="experience-hint">{editor.useTemplate ? "문제 → 분석 → 해결 → 기대 결과를 중심으로 초안을 작성합니다." : "확인한 자료를 바탕으로 활동 목록·시간순 기록 등 알맞은 형식으로 초안을 작성합니다."} 설정은 다음 초안 작성에 적용되며 현재 본문은 유지됩니다.</p>
        </div>
        {editor.useTemplate && <ol className="experience-story-guide" aria-label="경험 작성 흐름">{["문제", "분석", "해결", "기대 결과"].map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span>{step}{index < 3 && <ArrowRight size={14} aria-hidden="true" />}</li>)}</ol>}
        <div className="experience-editor-surface">
          <div className="experience-authoring-toolbar"><SegmentedTabs id="experience-content" label="본문 보기 방식" value={editor.preview ? "preview" : "markdown"} options={[{ value: "markdown", label: <><Code size={16} aria-hidden="true" />Markdown</> }, { value: "preview", label: <><Eye size={16} aria-hidden="true" />Preview</> }]} disabled={task.busy} onChange={value => workflow.updateEditor({ preview: value === "preview" })} /><span className="experience-word-count">{editor.markdown.length.toLocaleString("ko-KR")}자</span></div>
          <div id="experience-content-panel" role="tabpanel" aria-labelledby={`experience-content-${editor.preview ? "preview" : "markdown"}`} tabIndex={0}>
            {generation?.kind === "draft" ? <GenerationLoading {...generation} /> : editor.preview ? <div className="experience-authoring-preview">{editor.markdown.trim() ? <MarkdownDocument markdown={editor.markdown} /> : <p className="experience-preview-empty">Markdown 탭에서 작성한 내용이 여기에 표시됩니다.</p>}</div> : <label className="experience-markdown-label"><span className="visually-hidden">경험 Markdown 편집</span><textarea className="experience-authoring-markdown" value={editor.markdown} disabled={task.busy} maxLength={60_000} spellCheck={false} onChange={event => workflow.updateEditor({ markdown: event.target.value })} placeholder={editor.useTemplate ? "## 문제\n어떤 상황에서 무엇을 해결해야 했나요?\n\n## 분석\n원인과 제약은 무엇이고, 어떤 대안을 비교했나요?\n\n## 해결\n내 역할은 무엇이며, 어떤 판단으로 실행했나요?\n\n## 기대 결과\n무엇이 달라지길 기대했고, 어떻게 확인할 계획인가요?\n\n## 실제 결과와 근거\n확인된 변화만 적고, 아직 측정하지 않았다면 구분해 주세요." : "활동·프로젝트·기여를 자유롭게 기록하세요.\n\n- 참여한 작업과 나의 역할\n- 선택한 방법과 이유\n- 확인된 결과와 근거 링크\n\n나열형 기록이나 시간순 정리도 가능합니다."} rows={24} /></label>}
          </div>
        </div>
        <p className="experience-hint">이미지는 ![설명](https://…) 형식의 외부 URL로 넣을 수 있습니다.</p>
        {!!editor.questions.length && <section className="experience-authoring-questions"><h2>보완하면 좋은 내용</h2><ul>{editor.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></section>}
        <section className="experience-authoring-metadata"><div className="experience-metadata-heading"><div><h2>추천용 메타데이터</h2><p className="experience-hint">본문의 활동·기여·역량을 근거와 함께 정리합니다. 본문 형식은 바꾸지 않습니다.</p></div><button type="button" disabled={task.busy || !editor.markdown.trim()} onClick={() => void workflow.generateMetadata()}><Sparkle size={16} aria-hidden="true" />메타데이터 생성</button></div>{generation?.kind === "metadata" ? <GenerationLoading {...generation} /> : editor.metadata || editor.metadataFor ? <><label><span className="visually-hidden">추천용 메타데이터</span><textarea value={editor.metadata} disabled={task.busy} maxLength={12_000} rows={8} onChange={event => workflow.updateEditor({ metadata: event.target.value })} /></label><p className="experience-hint">사실과 다른 부분은 직접 고쳐 주세요.</p>{!metadataReady && <p role="status" className="experience-hint">경험이 변경되었습니다. 메타데이터를 다시 생성해 주세요.</p>}</> : <p className="experience-hint">본문을 작성한 뒤 생성해 주세요. 저장한 메타데이터는 AI가 경험을 추천할 때 사용합니다.</p>}</section>
      </section>
      <aside className="experience-authoring-materials" aria-label="참고 자료"><h2>참고 자료</h2><p>링크와 문서에서 경험 초안을 만들 수 있습니다. 생성된 본문은 자유롭게 수정하세요.</p>
        <label>관련 링크<textarea aria-describedby="experience-link-help" className="experience-links" value={editor.links} disabled={task.busy} onChange={event => workflow.updateEditor({ links: event.target.value })} placeholder="GitHub, 작업 문서 등의 링크를 한 줄에 하나씩" rows={4} /></label>
        <p id="experience-link-help" className="experience-hint">공개된 HTTP(S) 페이지를 한 줄에 하나씩 입력하세요. 브라우저에서 열려도 AI가 내용을 읽지 못할 수 있습니다.</p>
        <details className="experience-source-help"><summary>URL을 읽지 못하는 이유</summary>
          <p>링크는 웹 검색으로 내용을 확인합니다. 로그인·접근 제한·검색 도구 미지원 또는 동적으로 불러오는 화면에서는 실패할 수 있습니다. 읽은 내용의 출처 URL도 일치해야 근거로 사용합니다.</p>
          <p>Gerrit의 변경 상세·작성자 목록은 웹 검색에서 내용을 확인하지 못할 수 있습니다. 현재 Gerrit API로 직접 가져오는 기능은 없습니다. 변경 설명과 코드 차이를 TXT·MD로 첨부하거나 본문에 붙여 넣어 주세요.</p>
          <p>확인하지 못한 링크는 초안의 사실 근거에서 제외합니다. 추천 템플릿을 꺼도 링크 접근 방식은 같습니다.</p>
        </details>
        <label className="file-picker"><Paperclip size={18} aria-hidden="true" />문서 첨부<input type="file" className="visually-hidden" multiple disabled={task.busy} accept=".pdf,.docx,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.html,.css,.sql,.yml,.yaml,.xml,.log" aria-label="경험 파일 첨부" aria-describedby="experience-file-help" onChange={event => { workflow.updateEditor({ files: [...editor.files, ...Array.from(event.target.files ?? [])] }); event.target.value = ""; }} /></label>
        {!!editor.files.length && <ul className="experience-file-list">{editor.files.map((file, index) => <li key={`${index}-${file.name}`}><span>{file.name}</span><button type="button" className="text-button" disabled={task.busy} aria-label={`${file.name} 첨부 취소`} onClick={() => workflow.updateEditor({ files: editor.files.filter((_, i) => i !== index) })}>제거</button></li>)}</ul>}
        <p id="experience-file-help" className="experience-hint">PDF·DOCX 또는 UTF-8 텍스트·코드 파일을 읽습니다. 텍스트·코드는 파일당 2MB 이하, 읽은 내용은 파일당 10만 자까지 가능합니다.</p>
        <details className="experience-source-help"><summary>지원 파일 형식 보기</summary>
          <p>문서: PDF, DOCX. 텍스트·코드: TXT, MD, CSV, JSON, JS, JSX, TS, TSX, PY, JAVA, HTML, CSS, SQL, YML, YAML, XML, LOG.</p>
          <p>PDF·DOCX는 변환 과정에서 서버의 용량 제한을 확인합니다. 스캔 PDF는 문자 인식 결과를 확인해 주세요. 암호로 보호된 문서는 먼저 잠금을 해제해 주세요.</p>
          <p>ZIP·HWP·XLSX·PPTX와 이미지 파일 직접 첨부는 지원하지 않습니다. 필요한 내용을 PDF·DOCX·TXT로 변환해 주세요. 링크만 적은 텍스트 파일은 링크 대상의 본문을 대신하지 않습니다.</p>
        </details>
        <button type="button" className="experience-transform" disabled={task.busy || (!editor.markdown.trim() && !editor.links.trim() && !editor.files.length && !editor.sources.length)} onClick={() => void workflow.transformExperience()}><Sparkle size={16} aria-hidden="true" />자료로 초안 작성</button>
        <p className="experience-hint">원본 삭제는 최종 저장 시 반영됩니다. 삭제한 자료는 다음 초안 작성에서 제외되며, 이미 작성한 본문과 과거 작성본은 유지됩니다.</p>
        {!!editor.sources.length && <section className="experience-authoring-source-notes"><h3>참고한 자료 <span>{editor.sources.length}</span></h3><ul className="experience-source-list" aria-label="참고한 자료">{editor.sources.map(source => {
          const note = editor.sourceNotes.find(item => item.sourceId === source.id);
          const needsCheck = source.kind === "link" && note?.verified === false;
          const verified = source.kind !== "link" || note?.verified === true;
          const failureMessage = note?.failureReason === "content_unavailable" ? "웹 검색에서 페이지 본문을 확인하지 못했습니다." : note?.failureReason === "source_unverified" ? "입력한 URL과 조회 출처가 일치하지 않아 사용하지 않았습니다." : "웹 검색에서 본문과 출처를 확인하지 못했습니다.";
          return <li key={source.id} data-needs-check={needsCheck}><span className="experience-source-icon">{source.kind === "link" ? <Link size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}</span><div><strong>{source.name || source.url || "첨부 자료"}</strong><span className="experience-source-status">{verified ? <CheckCircle size={14} aria-hidden="true" /> : <WarningCircle size={14} aria-hidden="true" />}{source.kind !== "link" ? "본문 추출 완료" : note?.verified ? "내용 확인 완료" : needsCheck ? "내용 확인 필요" : "보관한 링크"}</span>{needsCheck && <p className="experience-source-failure">{failureMessage}</p>}<button type="button" className="text-button experience-source-remove" disabled={task.busy} aria-label={`${source.name || source.url || "메모"} 참고자료 삭제`} onClick={() => workflow.removeSource(source.id)}>삭제</button></div></li>;
        })}</ul>{editor.sourceNotes.some(note => !note.verified) && <p className="experience-hint">확인하지 못한 자료는 관련 내용을 본문이나 문서로 보완해 주세요.</p>}</section>}
        {!!editor.sources.length && <details className="experience-attached-sources"><summary>보관한 원본 {editor.sources.length}개</summary><ExperienceSources sources={editor.sources} onRemove={workflow.removeSource} disabled={task.busy} /></details>}
      </aside>
    </div>
    <footer className="experience-authoring-footer"><p role="status">{task.busy ? "경험을 처리하고 있습니다…" : metadataReady ? "내용과 메타데이터를 확인한 뒤 최종 저장하세요." : "추천용 메타데이터를 생성한 뒤 저장할 수 있습니다."}</p><button className="button-primary" disabled={task.busy || !editor.markdown.trim() || !metadataReady}>최종 저장<ArrowRight size={16} aria-hidden="true" /></button></footer>
  </form>;
}

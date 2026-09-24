import { useState } from "react";
import type { ApplicationController } from "../../application/useApplication";
import { MarkdownDocument, summaryMarkdown } from "./MarkdownDocument";

/** Retains access to previously saved context documents without creating experiences here. */
export function ExperienceWriting({ application }: { application: ApplicationController }) {
  const { workspace, view, task, experiencesWorkflow: workflow, navigation } = application;
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const context = view.context!;
  const documents = workspace.experienceDocuments.filter(item => item.contextId === context.id);
  const saved = documents.find(item => item.id === workflow.selectedDocumentId) ?? documents[0];
  const draft = workflow.writingDraft?.contextId === context.id ? workflow.writingDraft : null;
  const document = draft ?? saved;
  async function copy() {
    try { await navigator.clipboard.writeText(summaryMarkdown(document.markdown) || document.markdown); setCopied(true); }
    catch (error) { task.reportError(error, "복사하지 못했습니다. 편집 화면에서 복사해 주세요."); }
  }
  return <>
    <header className="topbar"><div><h1>{context.name} · 저장한 경험 문구</h1><p>경험 원본은 경험 기록에서 작성하고, JD에 맞는 문구는 이력서 검토에서 추천받습니다.</p></div><button disabled={task.busy} onClick={() => navigation.navigate(`/contexts/${context.id}`)}>이력서 검토로</button></header>
    <div className="experience-layout"><aside className="experience-list" aria-label="경험 작성본 목록">{documents.map(item => <button className="experience-list-item" key={item.id} disabled={task.busy} aria-current={item.id === document?.id ? "true" : undefined} onClick={() => { workflow.selectDocument(item.id); setEditing(false); setCopied(false); }}><strong>{item.input.experience.title}</strong><small>{new Date(item.updatedAt).toLocaleDateString("ko-KR")}</small></button>)}</aside>
      <section className="experience-writing-main" aria-label="경험 문서">{document ? <>
        <div className="writing-toolbar"><button disabled={task.busy} onClick={() => setEditing(!editing)}>{editing ? "미리보기" : "편집"}</button><button disabled={task.busy} onClick={() => void copy()}>요약 복사</button><span role="status">{copied ? "복사했습니다." : draft ? "저장 전 초안" : "저장됨"}</span></div>
        <div className="writing-paper">{editing ? <label className="markdown-editor-label">Markdown 편집<textarea className="markdown-editor" aria-label="경험 Markdown 편집" value={document.markdown} maxLength={60_000} disabled={task.busy} onChange={event => draft ? workflow.updateWriting(event.target.value) : workflow.editDocument(saved, event.target.value)} /></label> : <MarkdownDocument markdown={document.markdown} />}</div>
        <footer className="writing-footer">{draft ? <><button disabled={task.busy} onClick={workflow.discardWriting}>초안 취소</button><button disabled={task.busy || !draft.markdown.trim()} onClick={() => void workflow.saveWriting()}>작성본 저장</button></> : <button disabled={task.busy} onClick={() => void workflow.removeDocument(saved)}>작성본 삭제</button>}</footer>
      </> : <p className="panel-empty">저장한 경험 문구가 없습니다. 이력서 검토에서 경험을 추천받을 수 있습니다.</p>}</section>
    </div>
  </>;
}

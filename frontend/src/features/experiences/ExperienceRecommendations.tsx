import { useState } from "react";
import type { ApplicationController } from "../../application/useApplication";
import { MarkdownDocument, summaryMarkdown } from "./MarkdownDocument";
import "./experience-review.css";

export function ReviewExperienceSelection({ application }: { application: ApplicationController }) {
  const { workspace, view, locked } = application;
  const context = view.context!;
  const selected = context.selectedExperienceIds ?? [];
  const hasJd = view.links.some(link => workspace.materials.some(item => item.id === link.materialId && item.materialType === "jobPosting" && !item.deleted));
  return <details className="review-experience-selection"><summary>검토할 경험 · {selected.length ? `${selected.length}개 직접 선택` : "JD에 맞춰 자동 추천"}</summary>
    <p>{selected.length ? "선택한 경험의 JD 적합성을 확인하고 문구를 작성합니다. 다른 경험은 이유와 함께 추천한 뒤 추가 여부를 묻습니다." : "경험을 선택하지 않으면 저장한 경험에서 JD에 맞는 경험을 찾아 이유와 문구를 제공합니다."}</p>
    {!hasJd && <p className="notice">검토 자료에 JD를 추가하면 경험 추천을 받을 수 있습니다.</p>}
    <fieldset disabled={locked || !!workspace.activeRun}><legend>저장한 경험 선택</legend>{workspace.experiences.map(experience => <label key={experience.id}>
      <input type="checkbox" checked={selected.includes(experience.id)} disabled={!experience.markdown?.trim() || !experience.metadata?.trim()} onChange={event => void application.setContextExperiences(context.id, event.target.checked ? [...selected, experience.id] : selected.filter(id => id !== experience.id))} />
      <span>{experience.title}{(!experience.markdown?.trim() || !experience.metadata?.trim()) && <small> · 경험 기록에서 본문과 메타데이터 저장 필요</small>}</span>
    </label>)}{!workspace.experiences.length && <p>경험 기록 페이지에서 경험을 먼저 작성해 주세요.</p>}</fieldset>
  </details>;
}

export function ExperienceRecommendations({ application }: { application: ApplicationController }) {
  const { workspace, view, experiencesWorkflow: workflow, task, locked, historyId } = application;
  const [copied, setCopied] = useState("");
  const review = view.displayReview;
  if (!review || view.runningHere) return null;
  const recommendations = review.experienceRecommendations ?? [];
  if (!review.input.experiences?.length && !recommendations.length) return null;
  const snapshot = review.input.experiences ?? [];
  async function copy(id: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(id); }
    catch (error) { task.reportError(error, "복사하지 못했습니다. 문구를 선택해 복사해 주세요."); }
  }
  return <section className="experience-recommendations" aria-label="JD 경험 추천"><header><h2>JD에 맞는 경험</h2><p>추천 이유와 문구를 확인하고 이력서에 옮겨 주세요.</p></header>
    {!recommendations.length && <p>{review.errors.some(error => error.moduleKey === "finalReview") ? "경험 추천을 완료하지 못했습니다. 검토 오류를 확인해 주세요." : "이번 JD에 추가로 추천할 경험이 없습니다."}</p>}
    <div className="experience-recommendation-grid">{recommendations.map(item => {
      const experience = snapshot.find(candidate => candidate.id === item.experienceId);
      if (!experience) return null;
      const documentId = `${review.id}:${item.experienceId}`;
      const saved = workspace.experienceDocuments.find(document => document.id === documentId);
      const draft = workflow.writingDraft?.id === documentId ? workflow.writingDraft : null;
      const document = draft ?? saved;
      const text = document ? summaryMarkdown(document.markdown) || document.markdown : item.resumeBullets.map(bullet => `- ${bullet}`).join("\n");
      return <article className="experience-recommendation" key={item.experienceId} aria-label={`${experience.title} 추천`}>
        <span className="experience-kicker">{item.decision === "omit" ? "이번 JD에서는 생략" : item.decision === "suggest" && !document ? "추가 여부를 선택해 주세요" : "이력서 반영 추천"}</span><h3>{experience.title}</h3><p>{item.reason}</p>
        <ul className="experience-jd-evidence">{item.jobEvidence.map((evidence, index) => <li key={index}><strong>JD 근거</strong> · {evidence.consideredPoint}</li>)}</ul>
        {item.placement && <p><strong>반영 위치</strong> · {item.placement}</p>}
        {item.decision === "suggest" && !document && <><p>이 경험도 추가해서 문구를 작성할까요?</p><button className="button-primary" disabled={locked || !!historyId} onClick={() => void workflow.approveRecommendation(review, item.experienceId)}>이 경험도 추가하고 문구 작성</button></>}
        {text && <><div className="experience-recommendation-text"><MarkdownDocument markdown={text} /></div><button disabled={task.busy} onClick={() => void copy(documentId, text)}>이력서 문구 복사</button>{copied === documentId && <span role="status">복사했습니다.</span>}</>}
        {document && <details><summary>문구 편집 및 상세 설명</summary><label>경험 문구 Markdown<textarea maxLength={60_000} rows={12} disabled={locked || !!historyId} value={document.markdown} onChange={event => draft ? workflow.updateWriting(event.target.value) : workflow.editDocument(saved!, event.target.value)} /></label>{!!document.questions.length && <ul>{document.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>}</details>}
        {draft && <div className="experience-recommendation-actions"><button disabled={task.busy} onClick={workflow.discardWriting}>초안 취소</button><button className="button-primary" disabled={task.busy || !draft.markdown.trim()} onClick={() => void workflow.saveWriting()}>문구 저장</button></div>}
        {saved && !draft && <p role="status">문구 저장됨</p>}
      </article>;
    })}</div>
  </section>;
}

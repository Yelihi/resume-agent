import { useState } from "react";
import { Plus, MagnifyingGlass, PencilSimple } from "@phosphor-icons/react";
import type { ApplicationController } from "../../application/useApplication";
import { ExperienceSources } from "./ExperienceSources";
import { ExperienceEditor } from "./ExperienceEditor";
import { MarkdownDocument } from "./MarkdownDocument";

export function ExperienceLibrary({ application }: { application: ApplicationController }) {
  const { workspace, experiencesWorkflow: workflow, task } = application;
  const [query, setQuery] = useState("");
  const experiences = workspace.experiences.filter(item => `${item.title} ${item.period} ${item.markdown ?? ""} ${item.metadata ?? ""} ${item.sources.map(source => source.text + source.name).join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = experiences.find(item => item.id === workflow.selectedExperienceId) ?? experiences[0];
  const documents = workspace.experienceDocuments.filter(item => item.experienceId === selected?.id);
  if (workflow.editor) return <ExperienceEditor application={application} />;
  return <>
    <header className="topbar"><div><h1>경험 기록</h1><p>활동과 기여를 기록하고, 지원하는 회사에 맞춰 활용합니다.</p></div><button className="button-primary" disabled={task.busy} onClick={() => workflow.openEditor()}><Plus size={17} />경험 남기기</button></header>
    <div className="experience-layout"><aside className="experience-list" aria-label="경험 기록 목록">
      <label className="experience-search"><MagnifyingGlass size={18} aria-hidden="true" /><input type="search" aria-label="경험 검색" placeholder="경험 검색" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <p className="experience-list-count">기록 {experiences.length}개</p>
      {experiences.map(item => <button className="experience-list-item" key={item.id} aria-current={item.id === selected?.id ? "true" : undefined} disabled={task.busy} onClick={() => workflow.selectExperience(item.id)}>
        <strong>{item.title}</strong><span>{item.markdown || item.sources.find(source => source.kind === "note")?.text || item.sources[0]?.name}</span><small>{new Date(item.updatedAt).toLocaleDateString("ko-KR")} 기록 · 원본 {item.sources.length}개</small>
      </button>)}
      {!experiences.length && <p className="experience-list-empty">{query ? "검색한 경험이 없습니다." : "남긴 경험이 여기에 모입니다."}</p>}
    </aside><section className="experience-detail" aria-label="경험 원본">
      {selected ? <><header className="experience-detail-heading"><div><span className="experience-kicker">경험 원본</span><h2>{selected.title}</h2><p>{selected.period || "경험 기간 미입력"}</p></div><button disabled={task.busy} onClick={() => workflow.openEditor(selected)}><PencilSimple size={16} />경험 수정</button></header>
        {selected.markdown && <MarkdownDocument markdown={selected.markdown} />}
        {selected.metadata && <details className="experience-saved-metadata"><summary>추천용 메타데이터</summary><p>{selected.metadata}</p></details>}
        <ExperienceSources sources={selected.sources} />
        {!!documents.length && <section className="experience-uses"><h3>이 경험을 사용한 작업 공간</h3>{documents.map(doc => <button key={doc.id} className="text-button" disabled={task.busy} onClick={() => application.navigation.navigate(`/contexts/${doc.contextId}/experiences`)}>{workspace.contexts.find(context => context.id === doc.contextId)?.name}</button>)}</section>}
      </> : <div className="experience-empty"><h2>{query ? "다른 검색어로 찾아보세요" : "오늘 한 일부터 남겨 보세요"}</h2><p>{query ? "제목과 메모 내용으로 찾을 수 있습니다." : "메모 한 줄, 작업 링크, 프로젝트 파일로 시작할 수 있습니다."}</p>{!query && <button disabled={task.busy} onClick={() => workflow.openEditor()}><Plus size={16} />첫 경험 남기기</button>}</div>}
    </section></div>
  </>;
}

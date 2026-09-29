import type { ExperienceSource } from "../../domain/experience/entities";
import { OriginalDownload } from "../../components/OriginalDownload";

function SourceFile({ source }: { source: ExperienceSource }) {
  return <OriginalDownload original={source.original} name={source.name} />;
}
export function ExperienceSources({ sources, onRemove, disabled }: { sources: ExperienceSource[]; onRemove?: (id: string) => void; disabled?: boolean }) {
  return <div className="experience-sources">{sources.map(source => <section key={source.id}>
    <div className="source-heading"><span>{source.kind === "note" ? "메모" : source.kind === "link" ? "링크" : "파일"}</span><time dateTime={source.createdAt}>{new Date(source.createdAt).toLocaleDateString("ko-KR")}</time></div>
    {source.kind === "link" ? <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a> : <>
      {source.kind === "file" && <><h3>{source.name}</h3><SourceFile source={source} /></>}
      {source.kind === "note" ? <p className="experience-source-text">{source.text}</p> : <details><summary>읽어 온 내용 보기</summary><pre className="experience-source-text">{source.text}</pre></details>}
    </>}
    {onRemove && <button type="button" className="text-button experience-source-remove" disabled={disabled} aria-label={`${source.name || source.url || "메모"} 원본 삭제`} onClick={() => onRemove(source.id)}>원본 삭제</button>}
  </section>)}</div>;
}

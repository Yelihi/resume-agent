import { memo } from "react";
import { useWorkspaceSelector } from "../../hooks/useWorkspace";
import type { WorkspaceRepository } from "../../domain/workspace/ports";
import { ResumeViewer } from "../../viewer/ResumeViewer";
import { OriginalDownload } from "../../components/OriginalDownload";

type ResumePreviewProps = {
  store: WorkspaceRepository;
  resumeVersionId?: string;
  selectedLineIds: string[];
  selectedSuggestionNumber?: number;
};

function OriginalHistory({ store, contextId }: { store: WorkspaceRepository; contextId: string }) {
  const versions = useWorkspaceSelector(store, workspace => workspace.resumeVersions);
  const originals = versions.filter(version => version.contextId === contextId && version.original);
  if (!originals.length) return null;
  return <details className="original-history"><summary>저장한 원본 · {originals.length}개 버전</summary><ul>{originals.map(version =>
    <li key={version.id}>v{version.version} · {version.displayName} <OriginalDownload original={version.original} name={version.displayName} /></li>,
  )}</ul></details>;
}

/** Unrelated workspace changes and progress updates do not rebuild the document viewer. */
export const ResumePreview = memo(function ResumePreview({ store, resumeVersionId, selectedLineIds, selectedSuggestionNumber }: ResumePreviewProps) {
  const resume = useWorkspaceSelector(store, workspace => workspace.resumeVersions.find(version => version.id === resumeVersionId));
  return (
    <section className="viewer-panel" aria-label="문서 미리보기">
      <div className="panel-heading"><div><span className="eyebrow">DOCUMENT</span><h2>문서 미리보기</h2></div><span className="panel-meta">버전 {resume?.version}</span></div>
      {resume ? <><OriginalHistory store={store} contextId={resume.contextId} /><ResumeViewer resume={resume} selectedLineIds={selectedLineIds} selectedSuggestionNumber={selectedSuggestionNumber} /></> : <p className="panel-empty">원문을 확인할 수 없는 이전 검토입니다.</p>}
    </section>
  );
});

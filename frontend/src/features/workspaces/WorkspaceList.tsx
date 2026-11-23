import { PageHeading } from "../../components/PageHeading";
import { Pagination } from "../../components/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { Link } from "react-router";
import { FileText, Plus, Trash } from "@phosphor-icons/react";
import type { Workspace } from "../../domain/workspace/entities";
import type { Navigate } from "../../application/navigation";

export function WorkspaceList({ workspace, missingContext, busy, onNavigate, onDelete }: {
  workspace: Workspace; missingContext: boolean; busy: boolean; onNavigate: Navigate; onDelete: (id: string, name: string) => void;
}) {
  const pagination = usePagination(workspace.contexts);
  return <>
    <PageHeading title="이력서 작업 공간"
      actions={<button className="button-primary" onClick={() => onNavigate("/contexts/new")}><Plus size={18} aria-hidden="true" />새 작업 공간</button>} />
    {missingContext && <p className="notice">삭제되었거나 찾을 수 없는 작업 공간입니다.</p>}
    <section className="context-grid" aria-label="작업 공간 목록">{pagination.items.map(context => {
      const resume = workspace.resumeVersions.find(version => version.id === context.latestVersionId);
      const reviewCount = workspace.reviews.filter(review => review.contextId === context.id).length;
      const materialCount = workspace.contextMaterials.filter(link => link.contextId === context.id).length;
      return <article className="context-card" key={context.id}>
        <span className="card-icon"><FileText size={20} aria-hidden="true" /></span>
        <div className="catalog-entry">
          <h2><Link to={`/contexts/${context.id}`}>{context.name}</Link></h2>
          <p>{resume?.displayName ?? "이력서 확인 필요"} · 버전 {resume?.version ?? 1}</p>
        </div>
        <div className="card-actions"><small>검토 {reviewCount}회 · 자료 {materialCount}개</small>
          <button className="icon-button" disabled={busy || workspace.activeRun?.contextId === context.id}
            aria-label={`${context.name} 작업 공간 삭제`} onClick={() => onDelete(context.id, context.name)}><Trash size={18} /></button>
        </div>
      </article>;
    })}</section>
    {pagination.pageCount > 1 && <Pagination label="작업 공간 페이지" page={pagination.page} pageCount={pagination.pageCount} onPageChange={pagination.setPage} />}
    {!workspace.contexts.length && <div className="workspace-empty"><FileText size={44} /><h2>아직 작업 공간이 없습니다</h2><p>새 작업 공간에서 검토할 이력서를 등록하세요.</p></div>}
  </>;
}

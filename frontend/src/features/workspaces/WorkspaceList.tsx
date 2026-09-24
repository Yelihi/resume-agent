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
    <header className="topbar"><div><span className="eyebrow">YOUR WORKSPACES</span><h1>이력서 작업 공간</h1><p>지원 목적마다 이력서와 피드백을 독립적으로 관리하세요.</p></div><button className="button-primary" onClick={() => onNavigate("/contexts/new")}><Plus size={18} />새 작업 공간</button></header>
    {missingContext && <p className="notice">삭제되었거나 찾을 수 없는 작업 공간입니다.</p>}
    <section className="context-grid" aria-label="작업 공간 목록">{pagination.items.map(context => {
      const resume = workspace.resumeVersions.find(version => version.id === context.latestVersionId);
      const reviewCount = workspace.reviews.filter(review => review.contextId === context.id).length;
      const materialCount = workspace.contextMaterials.filter(link => link.contextId === context.id).length;
      return <article className="context-card" key={context.id}><div className="card-heading"><FileText size={25} /><span>버전 {resume?.version ?? 1}</span></div><h2><Link to={`/contexts/${context.id}`}>{context.name}</Link></h2><p>{resume?.displayName ?? "이력서 확인 필요"}</p><div className="card-actions"><small>검토 {reviewCount}회 · 자료 {materialCount}개</small><button className="icon-button" disabled={busy || workspace.activeRun?.contextId === context.id} aria-label={`${context.name} 작업 공간 삭제`} onClick={() => onDelete(context.id, context.name)}><Trash size={18} /></button></div></article>;
    })}</section>
    {!!workspace.contexts.length && <Pagination label="작업 공간 페이지" page={pagination.page} pageCount={pagination.pageCount} onPageChange={pagination.setPage} />}
    {!workspace.contexts.length && <div className="workspace-empty"><FileText size={44} /><h2>첫 이력서부터 시작하세요</h2><p>이력서 한 편과 필요한 자료를 모아<br />수정 과정을 이어갈 수 있습니다.</p></div>}
  </>;
}

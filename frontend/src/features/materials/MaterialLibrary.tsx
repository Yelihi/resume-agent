import { Pagination } from "../../components/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { FileText, Plus, Trash } from "@phosphor-icons/react";
import type { Material, MaterialVersion } from "../../domain/material/entities";
import type { MaterialFilter } from "../../application/useMaterialsWorkflow";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { OriginalDownload } from "../../components/OriginalDownload";

type MaterialLibraryProps = { materials: Material[]; versions: MaterialVersion[]; busy: boolean;
  onCreate: () => void; onEdit: (material: Material) => void; onDelete: (material: Material) => void };

export function MaterialLibrary({ materials, versions, busy, onCreate, onEdit, onDelete }: MaterialLibraryProps) {
  const [filter, setFilter] = useState<MaterialFilter>("all");
  const visibleMaterials = materials.filter(material => filter === "all" || material.materialType === filter);
  const pagination = usePagination(visibleMaterials);
  return <>
    <header className="topbar"><div><span className="eyebrow">REFERENCE LIBRARY</span><h1>자료 보관함</h1><p>한 번 정리한 자료를 여러 작업 공간에서 사용하세요.</p></div><button className="button-primary" disabled={busy} onClick={onCreate}><Plus size={18} />새 자료 등록</button></header>
    <div className="library-page">
      <SegmentedTabs id="material-filter" label="자료 종류" value={filter} onChange={value => { setFilter(value); pagination.setPage(1); }} options={[{ value: "all", label: "전체" }, { value: "company", label: "회사 자료" }, { value: "jobPosting", label: "채용 공고" }]} />
      <div tabIndex={0} role="tabpanel" id="material-filter-panel" aria-labelledby={`material-filter-${filter}`}>
        <div className="library-grid">{pagination.items.map(material => {
          const version = versions.find(candidate => candidate.id === material.currentVersionId);
          const content = version ?? material.draft;
          const originals = versions.filter(item => item.materialId === material.id && item.original);
          return <article className="library-card" key={material.id}><div className="card-heading"><FileText size={22} /><small>{material.materialType === "company" ? "회사 자료" : "채용 공고"} · {version ? `v${version.version}` : "저장 확인 필요"}</small></div><h2>{content?.title}</h2><p className="material-body">{version?.content ?? "이전 자료의 추출·저장을 완료해 주세요."}</p><small className="source-text">{content?.source}</small>
            {!!originals.length && <details className="original-history"><summary>저장한 원본 · {originals.length}개 버전</summary><ul>{originals.map(item => <li key={item.id}>v{item.version} · {item.source} <OriginalDownload original={item.original} name={item.source} /></li>)}</ul></details>}
            <div className="card-actions"><button className="button-secondary" disabled={busy} onClick={() => onEdit(material)}>{version ? "내용 보기·수정" : "추출·저장하기"}</button><button className="icon-button" disabled={busy} aria-label={`${content?.title} 삭제`} onClick={() => onDelete(material)}><Trash size={18} /></button></div></article>;
        })}</div>
        {!!visibleMaterials.length && <Pagination label="자료 보관함 페이지" page={pagination.page} pageCount={pagination.pageCount} onPageChange={pagination.setPage} />}
        {!visibleMaterials.length && <p className="panel-empty">{materials.length ? "이 종류의 자료가 없습니다." : "아직 자료가 없습니다. 파일이나 URL, 직접 입력으로 자료를 등록하세요."}</p>}
      </div>
    </div>
  </>;
}

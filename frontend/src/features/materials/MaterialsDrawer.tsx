import { FolderOpen, Plus, X } from "@phosphor-icons/react";
import { Dialog } from "../../components/Dialog";
import type { Material, MaterialVersion, ContextMaterial } from "../../domain/material/entities";

export type MaterialsDrawerProps = {
  materials: Material[];
  versions: MaterialVersion[];
  links: ContextMaterial[];
  busy: boolean;
  locked: boolean;
  onClose: () => void;
  onDetach: (materialId: string) => void;
  onOpenPicker: () => void;
  onCreate: () => void;
  onManage: () => void;
};

export function MaterialsDrawer({ materials, versions, links, busy, locked, onClose, onDetach, onOpenPicker, onCreate, onManage }: MaterialsDrawerProps) {
  return <Dialog className="materials-drawer" labelledBy="materials-title" onDismiss={onClose}>
    <div className="drawer-header"><div><span className="eyebrow">CONTEXT REFERENCES</span><h2 id="materials-title">검토 자료</h2></div><button className="icon-button" aria-label="검토 자료 닫기" onClick={onClose}><X size={21} aria-hidden="true" /></button></div>
    <p className="drawer-intro">선택한 자료는 다음 검토에 최신 저장 버전으로 적용됩니다.</p>
    <div className="drawer-content"><h3>연결된 자료</h3>{links.length === 0 && <p className="material-empty">연결된 자료가 없습니다.</p>}
      {links.map(link => {
        const material = materials.find(candidate => candidate.id === link.materialId);
        if (!material) return null;
        const version = versions.find(candidate => candidate.id === material.currentVersionId);
        const title = version?.title ?? material.draft?.title ?? "미완료 자료";
        return <article className="linked-material" key={link.id}><small>{material.materialType === "company" ? "회사 자료" : "채용 공고"} · {version ? `v${version.version}` : "추출·저장 필요"}</small><h4>{title}</h4><p>{version?.content ?? "자료 보관함에서 추출 내용을 확인하고 저장해 주세요."}</p><button disabled={busy || locked} className="text-button" aria-label={`${title} 연결 해제`} onClick={() => onDetach(material.id)}>연결 해제</button></article>;
      })}
      <div className="drawer-library-actions">
        <button className="button-secondary" disabled={busy || locked} aria-haspopup="dialog" onClick={onOpenPicker}><FolderOpen size={18} aria-hidden="true" />보관함에서 불러오기</button>
        <button className="button-primary" disabled={busy || locked} onClick={onCreate}><Plus size={18} aria-hidden="true" />새 자료 등록</button>
        <button className="text-button" disabled={busy} onClick={onManage}><FolderOpen size={17} aria-hidden="true" />자료 보관함에서 관리</button>
      </div>
    </div><p className="drawer-footnote">여기서 연결을 해제해도 보관함의 원본 자료는 유지됩니다.</p>
  </Dialog>;
}

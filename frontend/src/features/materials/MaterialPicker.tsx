import { X } from "@phosphor-icons/react";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import type { Material, MaterialVersion, ContextMaterial } from "../../domain/material/entities";

export type MaterialPickerProps = {
  materials: Material[];
  versions: MaterialVersion[];
  links: ContextMaterial[];
  busy: boolean;
  locked: boolean;
  onClose: () => void;
  onImport: (materialIds: string[]) => void;
};

export function MaterialPicker({ materials, versions, links, busy, locked, onClose, onImport }: MaterialPickerProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const savedMaterials = materials.flatMap(material => {
    const version = versions.find(candidate => candidate.id === material.currentVersionId);
    return version && !material.deleted ? [{ material, version }] : [];
  });
  const importIds = selectedIds.filter(id => savedMaterials.some(({ material }) => material.id === id) && !links.some(link => link.materialId === id));
  return <Dialog className="library-dialog" labelledBy="library-dialog-title" onDismiss={onClose} busy={busy}>
    <header className="drawer-header"><div><h2 id="library-dialog-title">보관함에서 불러오기</h2><p>검토에 사용할 자료를 선택한 뒤 가져오세요.</p></div><button className="icon-button" disabled={busy} aria-label="자료 선택 닫기" onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
    <div className="library-selection-list">
      {!savedMaterials.length && <p className="panel-empty">저장된 자료가 없습니다. 검토 자료에서 ‘새 자료 등록’으로 자료를 먼저 저장해 주세요.</p>}
      {savedMaterials.map(({ material, version }) => {
        const linked = links.some(link => link.materialId === material.id);
        return <label className="library-selection-row" key={material.id}>
          <input type="checkbox" aria-label={version.title} checked={linked || importIds.includes(material.id)} disabled={busy || locked || linked} onChange={event => setSelectedIds(current => event.target.checked ? [...current, material.id] : current.filter(id => id !== material.id))} />
          <span><strong>{version.title}</strong><small>{material.materialType === "company" ? "회사 자료" : "채용 공고"}{linked ? " · 이미 연결됨" : ""}</small><span className="source-text">{version.source}</span></span>
        </label>;
      })}
    </div>
    <footer className="library-selection-actions"><span role="status">{importIds.length}개 선택</span><button className="button-secondary" disabled={busy} onClick={onClose}>취소</button><button className="button-primary" disabled={busy || locked || !importIds.length} onClick={() => onImport(importIds)}>{busy ? "가져오는 중" : "가져오기"}</button></footer>
  </Dialog>;
}

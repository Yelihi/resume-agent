import { useState } from "react";
import { useDraftState } from "./useDraftState";
import { classifyFile, documentText, validateFileSize, validateTextLength } from "../domain/resume/policies";
import type { ValidationPolicy } from "../domain/resume/ports";
import type { Material, MaterialDraft } from "../domain/material/entities";
import type { Workspace } from "../domain/workspace/entities";
import type { WorkspaceRepository } from "../domain/workspace/ports";
import type { ApplicationServices, ConfirmAction } from "../domain/workspace/services";
import type { RunTask } from "./useAsyncTask";

export type MaterialEditorDraft = MaterialDraft & { input: string; file?: File; previewed: boolean; materialId?: string; baseVersionId?: string | null; attachTo?: string };
export type MaterialFilter = "all" | MaterialDraft["materialType"];

export function useMaterialsWorkflow({ store, workspace, services, resolvePolicy, runTask, confirm }: {
  store: Pick<WorkspaceRepository, "saveMaterial" | "deleteMaterial" | "attachMaterial" | "detachMaterial">; workspace: Workspace; services: Pick<ApplicationServices, "extractFile" | "previewMaterial">;
  resolvePolicy: () => Promise<ValidationPolicy>; runTask: RunTask; confirm: ConfirmAction;
}) {
  const [editor, setEditor, ownsEditor] = useDraftState<MaterialEditorDraft | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  function openEditor(material?: Material, attachTo?: string) {
    if (editor && !confirm("작성 중인 자료를 버릴까요?")) return;
    const version = workspace.materialVersions.find(candidate => candidate.id === material?.currentVersionId);
    const saved = version ?? material?.draft;
    const original = saved?.original;
    setEditor(saved ? { ...saved, input: saved.source.startsWith("http") ? saved.source : saved.content,
      previewed: !!version, materialId: material!.id, baseVersionId: material!.currentVersionId,
      ...(original instanceof Blob ? { file: new File([original], saved.source) } : {}) }
      : { title: "", materialType: "jobPosting", content: "", source: "직접 입력", input: "", previewed: false, attachTo });
    setDrawerOpen(false);
  }
  const updateEditor = (change: Partial<MaterialEditorDraft>) => setEditor(current => current ? { ...current, ...change } : current);
  const cancelEditor = () => { if (confirm("저장하지 않은 자료를 버릴까요?")) setEditor(null); };
  const extractMaterial = () => runTask(async () => {
    if (!editor) return;
    let content = editor.input;
    let source = "직접 입력";
    const policy = await resolvePolicy();
    if (!ownsEditor(editor)) return;
    if (editor.file) {
      const kind = classifyFile(editor.file);
      validateFileSize(editor.file, kind, policy);
      content = documentText((await services.extractFile(editor.file, kind)).document);
      source = editor.file.name;
    } else {
      validateTextLength(editor.input, policy);
      if (/https?:\/\//.test(editor.input)) {
        const result = await services.previewMaterial(editor.materialType, editor.input);
        content = result.content; source = result.sources.join("\n");
      }
    }
    if (ownsEditor(editor)) setEditor({ ...editor, content, source, previewed: true });
  }, "자료를 추출하지 못했습니다. 입력은 유지됩니다.");
  const saveMaterial = () => runTask(async () => {
    if (!editor) return;
    validateTextLength(editor.content, await resolvePolicy());
    if (!ownsEditor(editor)) return;
    await store.saveMaterial({ title: editor.title, materialType: editor.materialType, content: editor.content, source: editor.source,
      ...((editor.file ?? editor.original) ? { original: editor.file ?? editor.original } : {}) }, editor.materialId, editor.attachTo, editor.baseVersionId);
    if (ownsEditor(editor)) setEditor(null);
  }, "자료를 저장하지 못했습니다.");
  async function deleteMaterial(material: Material) {
    const linkedNames = workspace.contextMaterials.filter(link => link.materialId === material.id)
      .map(link => workspace.contexts.find(context => context.id === link.contextId)?.name).filter(Boolean);
    if (!confirm(`자료를 삭제할까요?${linkedNames.length ? `\n연결 해제될 작업 공간: ${linkedNames.join(", ")}` : ""}\n과거 검토에서 사용한 자료 버전은 유지됩니다.`)) return;
    await runTask(() => store.deleteMaterial(material.id), "자료를 삭제하지 못했습니다.");
  }
  const attachMaterials = (contextId: string, materialIds: string[]) => runTask(async () => {
    await store.attachMaterial(contextId, materialIds); setSelectionOpen(false);
  }, "자료를 연결하지 못했습니다.");
  const detachMaterial = (contextId: string, materialId: string) => runTask(() => store.detachMaterial(contextId, materialId), "자료 연결을 해제하지 못했습니다.");
  return { editor, openEditor, updateEditor, cancelEditor, extractMaterial, saveMaterial, deleteMaterial,
    drawerOpen, setDrawerOpen, selectionOpen, setSelectionOpen, attachMaterials, detachMaterial,
    reset: () => { setEditor(null); setDrawerOpen(false); setSelectionOpen(false); } };
}

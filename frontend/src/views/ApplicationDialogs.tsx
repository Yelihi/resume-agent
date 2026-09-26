import { MaterialEditor } from "../features/materials/MaterialEditor";
import { MaterialsDrawer } from "../features/materials/MaterialsDrawer";
import { MaterialPicker } from "../features/materials/MaterialPicker";
import { ErrorPopup } from "../components/ErrorPopup";
import { ExtractionPreview } from "../components/ExtractionPreview";
import type { ApplicationController } from "../application/useApplication";
export function ApplicationDialogs({ application }: { application: ApplicationController }) {
  const { materialsWorkflow, resumeWorkflow, view: { context }, task, locked, navigation, workspace, view } = application;
  return <>
    {materialsWorkflow.editor && <MaterialEditor editor={materialsWorkflow.editor} updateEditor={materialsWorkflow.updateEditor} busy={task.busy} onCancel={materialsWorkflow.cancelEditor} onExtract={() => void materialsWorkflow.extractMaterial()} onSave={() => void materialsWorkflow.saveMaterial()} />}
    {materialsWorkflow.drawerOpen && context && <MaterialsDrawer materials={view.materials} versions={workspace.materialVersions} links={view.links} busy={task.busy} locked={locked} onClose={() => materialsWorkflow.setDrawerOpen(false)} onDetach={materialId => void materialsWorkflow.detachMaterial(context.id, materialId)} onOpenPicker={() => materialsWorkflow.setSelectionOpen(true)} onCreate={() => materialsWorkflow.openEditor(undefined, context.id)} onManage={() => navigation.navigate("/materials")} />}
    {materialsWorkflow.selectionOpen && context && <MaterialPicker materials={view.materials} versions={workspace.materialVersions} links={view.links} busy={task.busy} locked={locked} onClose={() => materialsWorkflow.setSelectionOpen(false)} onImport={materialIds => void materialsWorkflow.attachMaterials(context.id, materialIds)} />}
    <ErrorPopup error={task.error} onClose={task.clearError} />
    {(resumeWorkflow.processingStage || resumeWorkflow.pendingResume) && <ExtractionPreview input={resumeWorkflow.pendingResume} processingStage={resumeWorkflow.processingStage} displayName={resumeWorkflow.draft.inputMode === "file" ? resumeWorkflow.draft.file?.name : "직접 입력 이력서"} busy={task.busy} onCancel={resumeWorkflow.cancelExtraction} onConfirm={() => void resumeWorkflow.confirmExtraction(context)} />}
  </>;
}

import { MaterialLibrary } from "../features/materials/MaterialLibrary";
import { useApplicationView } from "./context";
export function MaterialLibraryView() {
  const { application } = useApplicationView();
  const { materialsWorkflow, view, workspace, task } = application;
  return <MaterialLibrary materials={view.materials} versions={workspace.materialVersions} busy={task.busy} onCreate={() => materialsWorkflow.openEditor()} onEdit={materialsWorkflow.openEditor} onDelete={material => void materialsWorkflow.deleteMaterial(material)} />;
}

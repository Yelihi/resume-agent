import { WorkspaceList } from "../features/workspaces/WorkspaceList";
import { useApplicationView } from "./context";
export function WorkspaceListView() {
  const { application } = useApplicationView();
  return <WorkspaceList workspace={application.workspace} missingContext={false} busy={application.task.busy} onNavigate={application.navigation.navigate} onDelete={application.deleteContext} />;
}

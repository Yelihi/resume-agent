import { WorkspaceScreen } from "../features/workspaces/WorkspaceScreen";
import { useApplicationView } from "./context";
import { NotFoundView } from "./NotFoundView";
export function WorkspaceView() {
  const { application, store } = useApplicationView();
  return application.view.context ? <WorkspaceScreen application={application} store={store} /> : <NotFoundView missingContext />;
}

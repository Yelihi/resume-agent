import { ResumeUpload } from "../features/resume/ResumeUpload";
import { useApplicationView } from "./context";
import { NotFoundView } from "./NotFoundView";
export function ResumeUploadView() {
  const { application } = useApplicationView();
  const { view, task, locked, navigation, resumeWorkflow } = application;
  const { context } = view;
  if (!view.isNew && !context) return <NotFoundView missingContext />;
  return <ResumeUpload contextName={context?.name} isNew={view.isNew} draft={resumeWorkflow.draft} busy={task.busy} locked={locked} onChange={resumeWorkflow.updateDraft}
    onBack={() => navigation.navigate(context ? `/contexts/${context.id}` : "/contexts")} onSave={() => void resumeWorkflow.saveResume()} />;
}

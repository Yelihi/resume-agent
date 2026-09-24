import { ExperienceWriting } from "../features/experiences/ExperienceWriting";
import { useApplicationView } from "./context";
import { NotFoundView } from "./NotFoundView";
import { usePageAnnouncement } from "./usePageAnnouncement";
export function ExperienceWritingView() {
  const { application } = useApplicationView();
  usePageAnnouncement();
  return application.view.context ? <ExperienceWriting key={application.view.context.id} application={application} /> : <NotFoundView missingContext />;
}

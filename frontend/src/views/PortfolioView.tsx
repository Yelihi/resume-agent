import { PortfolioReviewScreen } from "../features/portfolio/PortfolioReview";
import { NotFoundView } from "./NotFoundView";
import { useApplicationDependencies, useApplicationView } from "./context";

export function PortfolioView() {
  const { application, store } = useApplicationView();
  const { services, preview } = useApplicationDependencies();
  const context = application.view.context;
  if (!context) return <NotFoundView missingContext />;
  return <PortfolioReviewScreen key={context.id} context={context} workspace={application.workspace} store={store}
    services={services ?? {}} disabled={preview || application.task.busy || !!application.workspace.activeRun} />;
}

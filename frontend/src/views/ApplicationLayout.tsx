import { Outlet, useMatches } from "react-router";
import { useApplication } from "../application/useApplication";
import type { WorkspaceRoute } from "../application/navigation";
import { AppShell } from "../layout/AppShell";
import { ApplicationDialogs } from "./ApplicationDialogs";
import { useApplicationDependencies } from "./context";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation";
import { usePageAnnouncement } from "./usePageAnnouncement";

export function ApplicationLayout() {
  const dependencies = useApplicationDependencies();
  const matches = useMatches();
  const match = matches[matches.length - 1];
  const route: WorkspaceRoute = { page: (match.handle as { page: WorkspaceRoute["page"] }).page, contextId: match.params.contextId };
  const application = useApplication({ ...dependencies, route, navigate: (path, saved) => navigation.navigate(path, saved) });
  const navigation = useWorkspaceNavigation({ dirty: application.dirty, busy: application.task.busy, confirm: dependencies.confirm, onLeave: application.resetForNavigation });
  const { workspace, view, loaded, loadFailed, task } = application;
  usePageAnnouncement(loaded);
  return <AppShell>
    <main className="dashboard-main" id="workspace" tabIndex={-1}>
      {dependencies.preview && <aside className="notice" aria-label="미리보기 안내"><strong>브라우저 미리보기</strong><p>직접 입력·TXT 이력서와 텍스트 자료를 저장하고 수정할 수 있습니다. 데이터는 이 브라우저에만 저장됩니다. AI·OCR·PDF/DOCX 변환·URL 가져오기·계정·서버 동기화는 사용할 수 없습니다. 테스트용 내용을 사용해 주세요.</p></aside>}
      {workspace.activeRun && !view.runningHere && <div className="notice">다른 작업 공간에서 검토 중입니다. <button onClick={() => navigation.navigate(`/contexts/${workspace.activeRun!.contextId}`)}>진행 보기</button></div>}
      {!loaded ? <div className="panel-empty"><p role="status">{loadFailed ? "작업 공간을 불러오지 못했습니다." : "작업 공간을 불러오고 있습니다."}</p>{loadFailed && <button disabled={task.busy} onClick={() => void application.reloadWorkspace()}>다시 불러오기</button>}</div>
        : <Outlet context={{ application, store: dependencies.store }} />}
    </main>
    <ApplicationDialogs application={application} />
  </AppShell>;
}

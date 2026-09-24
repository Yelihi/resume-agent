import { Link } from "react-router";
import { AppShell } from "../layout/AppShell";
import { usePageAnnouncement } from "./usePageAnnouncement";
export function RouteErrorView() {
  usePageAnnouncement();
  return <AppShell><main className="dashboard-main" id="workspace" tabIndex={-1}><header className="topbar"><h1>화면을 불러오지 못했습니다</h1></header><div className="panel-empty" role="alert"><p>잠시 후 다시 시도해 주세요.</p><Link to="/contexts">작업 공간 목록</Link></div></main></AppShell>;
}

import type { ReactNode } from "react";
import { FileText, FolderOpen, Notebook, Gear } from "@phosphor-icons/react";
import { Link, NavLink } from "react-router";

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell"><a className="skip-link" href="#workspace" onClick={event => { event.preventDefault(); document.getElementById("workspace")?.focus(); }}>본문 바로가기</a><aside className="side-rail">
    <Link className="wordmark" to="/contexts" aria-label="Resume Review 홈">RR</Link>
    <nav aria-label="주 메뉴">{[{ path: "/contexts", label: "작업 공간", Icon: FileText }, { path: "/experiences", label: "경험 기록", Icon: Notebook }, { path: "/materials", label: "자료 보관함", Icon: FolderOpen }].map(({ path, label, Icon }) => <NavLink key={path} className={({ isActive }) => `rail-link ${isActive ? "is-active" : ""}`} to={path} aria-label={label}><Icon size={21} aria-hidden="true" /><span>{label}</span></NavLink>)}</nav>
    <NavLink className={({ isActive }) => `rail-link ${isActive ? "is-active" : ""}`} to="/settings" aria-label="설정"><Gear size={21} aria-hidden="true" /><span>설정</span></NavLink>
    <p className="rail-note">원문은 유지하고<br />근거만 제안합니다.</p>
  </aside>{children}</div>;
}

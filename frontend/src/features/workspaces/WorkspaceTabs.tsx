import { NavLink } from "react-router";
export function WorkspaceTabs({ contextId }: { contextId: string }) {
  return <nav className="workspace-tabs" aria-label="작업 공간 화면"><NavLink to={`/contexts/${contextId}`} end>이력서 검토</NavLink><NavLink to={`/contexts/${contextId}/portfolio`}>포트폴리오</NavLink></nav>;
}

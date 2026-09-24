import { Link } from "react-router";
export function NotFoundView({ missingContext = false }: { missingContext?: boolean }) {
  return <><header className="topbar"><h1>{missingContext ? "작업 공간을 찾을 수 없습니다" : "페이지를 찾을 수 없습니다"}</h1></header>
    <div className="panel-empty"><p>{missingContext ? "삭제되었거나 찾을 수 없는 작업 공간입니다." : "주소를 확인하거나 작업 공간 목록으로 이동해 주세요."}</p><Link className="button-secondary" to="/contexts">작업 공간 목록</Link></div></>;
}

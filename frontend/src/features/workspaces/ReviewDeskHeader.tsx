import type { ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { Link } from "react-router";
import { WorkspaceTabs } from "./WorkspaceTabs";
import "./review-desk.css";

type ReviewDeskHeaderProps = {
  contextId: string;
  title: string;
  identity: ReactNode;
  actions: ReactNode;
  versionControl?: ReactNode;
  onBack?: () => void;
  backDisabled?: boolean;
};

export function ReviewDeskHeader({ contextId, title, identity, actions, versionControl, onBack, backDisabled }: ReviewDeskHeaderProps) {
  return <header>
    <div className="desk-header">
      <div className="desk-identity">
        {onBack
          ? <button className="desk-back" aria-label="작업 공간 목록" disabled={backDisabled} onClick={onBack}><ArrowLeft size={17} /></button>
          : <Link className="desk-back" to="/contexts" aria-label="작업 공간 목록"><ArrowLeft size={17} /></Link>}
        <div><h1>{title}</h1><p>{identity}</p></div>
      </div>
      <div className="desk-actions">{actions}</div>
    </div>
    <div className="desk-bar"><WorkspaceTabs contextId={contextId} />{versionControl}</div>
  </header>;
}

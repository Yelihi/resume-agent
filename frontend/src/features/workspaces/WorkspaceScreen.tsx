import { ArrowLeft, CheckCircle, FileText, FolderOpen, Play, UploadSimple } from "@phosphor-icons/react";
import type { ApplicationController } from "../../application/useApplication";
import { retryModuleLabels } from "../../application/selectWorkspaceView";
import { ResumePreview } from "../resume/ResumePreview";
import type { WorkspaceRepository } from "../../domain/workspace/ports";
import { ReviewResults } from "../review/ReviewResults";
import { ExperienceRecommendations, ReviewExperienceSelection } from "../experiences/ExperienceRecommendations";
import { WorkspaceTabs } from "./WorkspaceTabs";

export function WorkspaceScreen({ application, store }: { application: ApplicationController; store: WorkspaceRepository }) {
  const { workspace, view, navigation, task, materialsWorkflow, reviewWorkflow, locked, historyId, selection } = application;
  const { context, resume, viewedResume, runningHere } = view;
  if (!context) return null;
  return <>
    <header className="topbar"><div className="document-identity"><FileText size={22} /><div><h1>{context.name}</h1><span className="status-ready"><CheckCircle size={14} />버전 {resume?.version ?? 1} · {resume?.displayName}</span></div></div><div className="topbar-actions">
      <button className="button-secondary" disabled={task.busy} aria-haspopup="dialog" onClick={() => materialsWorkflow.setDrawerOpen(true)}><FolderOpen size={18} />검토 자료 <span className="count-badge">{view.links.length}</span></button>
      <button className="button-secondary" disabled={locked} onClick={() => navigation.navigate(`/contexts/${context.id}/upload`)}><UploadSimple size={17} />수정본 업로드</button>
      {!historyId && view.retryModules.map(module => <button key={module} className="button-secondary" disabled={locked || !!materialsWorkflow.editor || !!workspace.activeRun} onClick={() => { if (view.attempt) void reviewWorkflow.retry(view.attempt.id, module); }}>모듈 다시 실행{view.retryModules.length > 1 ? ` · ${retryModuleLabels[module]}` : ""}</button>)}
      {runningHere ? <button className="button-danger" onClick={() => void reviewWorkflow.cancelCurrent()}>검토 취소</button> : <button className="button-primary" disabled={task.busy || !!materialsWorkflow.editor || !!workspace.activeRun || !resume?.document || view.unhandledCount > 0} onClick={() => void reviewWorkflow.beginReview(context.id)}><Play size={17} />이력서 검토하기</button>}
    </div></header>
    <WorkspaceTabs contextId={context.id} />
    <div className="context-toolbar"><button className="text-button" disabled={task.busy} onClick={() => navigation.navigate("/contexts")}><ArrowLeft size={16} />작업 공간 목록</button>
      <label>검토 기록<select aria-label="검토 기록" disabled={locked} value={historyId} onChange={event => application.selectHistory(event.target.value)}><option value="">현재 작업</option>{workspace.reviews.filter(review => review.contextId === context.id).map((review, index) => <option value={review.id} key={review.id}>{index + 1}차 검토 · {review.status} · {new Date(review.createdAt).toLocaleString("ko-KR")}</option>)}</select></label>
    </div>
    {view.unhandledCount > 0 && !historyId && <p className="notice">{view.retryModules.length ? "오류 모듈은 제안 처리 없이 상단에서 다시 실행할 수 있습니다." : `다음 검토 전에 남은 제안 ${view.unhandledCount}건에 Resolve 또는 Skip을 선택해 주세요.`}</p>}
    {resume?.document?.extraction && <p className="notice" role="status">{resume.document.extraction.status === "recovered" ? "원문 추출 중 자동 복구한 구간이 있습니다." : resume.document.extraction.status === "needs_review" ? "확인이 필요한 추출 내용을 사용자가 확인했습니다." : "추출이 완료되었습니다. 자동 검사에서 깨짐 징후가 발견되지 않았습니다."}</p>}
    {reviewWorkflow.connectionFailed && runningHere && <p className="notice">연결 또는 저장을 완료하지 못했습니다. <button onClick={reviewWorkflow.reconnect}>다시 연결</button> 서버가 종료됐다면 검토 취소로 연결을 정리할 수 있습니다.</p>}
    {!historyId && <ReviewExperienceSelection application={application} />}
    <div className="review-workspace" role="region" aria-label="이력서 검토 작업 영역">
      <ResumePreview store={store} resumeVersionId={viewedResume?.id} selectedLineIds={selection.lineIds} selectedSuggestionNumber={selection.number} />
      <ReviewResults key={context.id} suggestions={view.suggestions} attempt={view.attempt} displayReview={view.displayReview} currentReview={view.currentReview}
        resumeVersionId={resume?.id} viewedResumeVersionId={viewedResume?.id} materialVersions={workspace.materialVersions} historical={!!historyId}
        locked={locked} running={runningHere} progress={reviewWorkflow.progress} delayed={reviewWorkflow.delayed} connectionFailed={reviewWorkflow.connectionFailed}
        initialFeedback={context.userFeedback} onFeedbackSave={value => void application.saveFeedback(context.id, value)}
        onSuggestionChange={(suggestion, change) => void application.setSuggestion(context.id, suggestion.id, change)} onSelectQuote={application.selectQuote} />
    </div>
    <ExperienceRecommendations key={view.displayReview?.id} application={application} />
  </>;
}

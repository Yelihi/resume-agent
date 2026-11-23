import { FileText, FolderOpen, Play, UploadSimple } from "@phosphor-icons/react";
import type { ApplicationController } from "../../application/useApplication";
import { retryModuleLabels } from "../../application/selectWorkspaceView";
import { ResumePreview } from "../resume/ResumePreview";
import type { WorkspaceRepository } from "../../domain/workspace/ports";
import { ReviewResults } from "../review/ReviewResults";
import { ExperienceRecommendations, ReviewExperienceSelection } from "../experiences/ExperienceRecommendations";
import { ReviewDeskHeader } from "./ReviewDeskHeader";

export function WorkspaceScreen({ application, store }: { application: ApplicationController; store: WorkspaceRepository }) {
  const { workspace, view, navigation, task, materialsWorkflow, reviewWorkflow, locked, historyId, selection } = application;
  const { context, resume, viewedResume, runningHere } = view;
  if (!context) return null;
  return <div className="review-desk">
    <ReviewDeskHeader contextId={context.id} title={context.name} backDisabled={task.busy}
      onBack={() => navigation.navigate("/contexts")}
      identity={<><FileText size={14} aria-hidden="true" />{`버전 ${resume?.version ?? 1} · ${resume?.displayName ?? "이력서"}`}</>}
      actions={<>
      <button className="button-secondary" disabled={task.busy} aria-haspopup="dialog" onClick={() => materialsWorkflow.setDrawerOpen(true)}><FolderOpen size={18} />검토 자료 <span className="count-badge">{view.links.length}</span></button>
      <button className="button-secondary" disabled={locked} onClick={() => navigation.navigate(`/contexts/${context.id}/upload`)}><UploadSimple size={17} />수정본 업로드</button>
      {!historyId && view.retryModules.map(module => <button key={module} className="button-secondary" disabled={locked || !!materialsWorkflow.editor || !!workspace.activeRun} onClick={() => { if (view.attempt) void reviewWorkflow.retry(view.attempt.id, module); }}>모듈 다시 실행{view.retryModules.length > 1 ? ` · ${retryModuleLabels[module]}` : ""}</button>)}
      {runningHere ? <button className="button-danger" onClick={() => void reviewWorkflow.cancelCurrent()}>검토 취소</button> : <button className="button-primary" disabled={task.busy || !!materialsWorkflow.editor || !!workspace.activeRun || !resume?.document || view.unhandledCount > 0} onClick={() => void reviewWorkflow.beginReview(context.id)}><Play size={17} />이력서 검토하기</button>}
      </>}
      versionControl={<label>검토 기록<select aria-label="검토 기록" disabled={locked} value={historyId} onChange={event => application.selectHistory(event.target.value)}><option value="">현재 작업</option>{workspace.reviews.filter(review => review.contextId === context.id).map((review, index) => <option value={review.id} key={review.id}>{index + 1}차 검토 · {review.status} · {new Date(review.createdAt).toLocaleString("ko-KR")}</option>)}</select></label>} />
    {view.unhandledCount > 0 && !historyId && <p className="desk-notice">{view.retryModules.length ? "오류 모듈은 제안 처리 없이 상단에서 다시 실행할 수 있습니다." : `다음 검토 전에 남은 제안 ${view.unhandledCount}건에 반영 확인 또는 건너뛰기를 선택해 주세요.`}</p>}
    {resume?.document?.extraction && resume.document.extraction.status !== "complete" && <p className="desk-notice" role="status">{resume.document.extraction.status === "recovered" ? "원문 추출 중 자동 복구한 구간이 있습니다." : "확인이 필요한 추출 내용을 사용자가 확인했습니다."}</p>}
    {reviewWorkflow.connectionFailed && runningHere && <p className="notice">연결 또는 저장을 완료하지 못했습니다. <button onClick={reviewWorkflow.reconnect}>다시 연결</button> 서버가 종료됐다면 검토 취소로 연결을 정리할 수 있습니다.</p>}
    {!historyId && <div className="desk-experience"><ReviewExperienceSelection application={application} /></div>}
    <div className="review-workspace" role="region" aria-label="이력서 검토 작업 영역">
      <ResumePreview store={store} resumeVersionId={viewedResume?.id} selectedLineIds={selection.lineIds} selectedSuggestionNumber={selection.number} />
      <ReviewResults key={context.id} suggestions={view.suggestions} attempt={view.attempt} displayReview={view.displayReview} currentReview={view.currentReview}
        resumeVersionId={resume?.id} viewedResumeVersionId={viewedResume?.id} materialVersions={workspace.materialVersions} historical={!!historyId}
        locked={locked} running={runningHere} progress={reviewWorkflow.progress} delayed={reviewWorkflow.delayed} connectionFailed={reviewWorkflow.connectionFailed}
        initialFeedback={context.userFeedback} onFeedbackSave={value => void application.saveFeedback(context.id, value)}
        onSuggestionChange={(suggestion, change) => void application.setSuggestion(context.id, suggestion.id, change)} onSelectQuote={application.selectQuote} />
    </div>
    <ExperienceRecommendations key={view.displayReview?.id} application={application} />
  </div>;
}

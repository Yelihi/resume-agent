import { useCallback, useEffect, useRef, useState } from "react";
import type { ValidationPolicy } from "../domain/resume/ports";
import type { WorkspaceRepository } from "../domain/workspace/ports";
import { useWorkspace } from "../hooks/useWorkspace";
import type { ApplicationServices, ConfirmAction } from "../domain/workspace/services";
import { useAsyncTask } from "./useAsyncTask";
import type { Navigate, WorkspaceRoute } from "./navigation";
import { useResumeWorkflow } from "./useResumeWorkflow";
import { useMaterialsWorkflow } from "./useMaterialsWorkflow";
import { useReviewWorkflow } from "./useReviewWorkflow";
import { selectWorkspaceView } from "./selectWorkspaceView";
import { useExperiencesWorkflow } from "./useExperiencesWorkflow";

export type ApplicationDependencies = { store: WorkspaceRepository; services: ApplicationServices; confirm: ConfirmAction; preview?: boolean };

export function useApplication({ store, services, confirm, route, navigate }: ApplicationDependencies & { route: WorkspaceRoute; navigate: Navigate }) {
  const { workspace, loaded, refresh } = useWorkspace(store);
  const task = useAsyncTask();
  const [loadFailed, setLoadFailed] = useState(false);
  const [historyId, setHistoryId] = useState("");
  const [selection, setSelection] = useState<{ lineIds: string[]; number?: number }>({ lineIds: [] });
  const policyRequest = useRef<{ services: ApplicationServices; promise: Promise<ValidationPolicy> } | undefined>(undefined);
  const resolvePolicy = useCallback(() => {
    if (policyRequest.current?.services === services) return policyRequest.current.promise;
    const promise = services.getValidationPolicy().catch(error => {
      if (policyRequest.current?.promise === promise) policyRequest.current = undefined;
      throw error;
    });
    policyRequest.current = { services, promise };
    return promise;
  }, [services]);
  const resumeWorkflow = useResumeWorkflow({ store, services, resolvePolicy, runTask: task.runTask, onSaved: contextId => navigation.navigate(`/contexts/${contextId}`, true) });
  const materialsWorkflow = useMaterialsWorkflow({ store, workspace, services, resolvePolicy, runTask: task.runTask, confirm });
  const experiencesWorkflow = useExperiencesWorkflow({ store, workspace, services, runTask: task.runTask, confirm });
  const navigation = { navigate };
  const resetForNavigation = () => { resumeWorkflow.reset(); materialsWorkflow.reset(); experiencesWorkflow.reset(); setHistoryId(""); setSelection({ lineIds: [] }); };
  const dirty = resumeWorkflow.dirty || !!materialsWorkflow.editor || experiencesWorkflow.dirty;
  const view = selectWorkspaceView(workspace, route, historyId);
  const reviewWorkflow = useReviewWorkflow({ store, services, activeRunId: workspace.activeRun?.runId, runTask: task.runTask, reportError: task.reportError, onStarted: () => setHistoryId("") });
  // Hydration, browser focus, and service loading are external effects; drafts are event-owned.
  useEffect(() => {
    let active = true;
    void refresh().then(() => { if (active) setLoadFailed(false); }).catch(error => { if (active) { setLoadFailed(true); task.reportError(error, "저장 데이터를 불러오지 못했습니다."); } });
    void resolvePolicy().catch(error => { if (active) task.reportError(error, "입력 정책을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [refresh, resolvePolicy, task.reportError]);
  useEffect(() => {
    const onFocus = () => { if (!task.busy) void refresh().catch(error => task.reportError(error, "저장 데이터를 갱신하지 못했습니다.")); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, task.busy, task.reportError]);
  const selectQuote = (lineIds: string[], number: number) => {
    setSelection({ lineIds, number });
  };
  const deleteContext = (contextId: string, name: string) => {
    if (confirm(`'${name}'의 이력서·검토·피드백을 모두 삭제할까요? 공용 자료는 유지됩니다.`)) void task.runTask(() => store.deleteContext(contextId), "작업 공간을 삭제하지 못했습니다.");
  };
  return { workspace, loaded, loadFailed, task, navigation, dirty, resetForNavigation,
    reloadWorkspace: () => task.runTask(async () => { await refresh(); setLoadFailed(false); }, "저장 데이터를 불러오지 못했습니다."), view, resumeWorkflow, materialsWorkflow, experiencesWorkflow, reviewWorkflow, historyId, selection,
    locked: task.busy || view.runningHere, selectQuote, deleteContext,
    selectHistory: (reviewId: string) => { setHistoryId(reviewId); setSelection({ lineIds: [] }); },
    setContextExperiences: (contextId: string, ids: string[]) => task.runTask(() => store.setContextExperiences(contextId, ids), "경험 선택을 저장하지 못했습니다."),
    saveFeedback: (contextId: string, value: string) => task.runTask(() => store.saveReviewFeedback(contextId, value), "의견을 저장하지 못했습니다."),
    setSuggestion: (contextId: string, suggestionId: string, change: Parameters<WorkspaceRepository["setSuggestionFeedback"]>[2]) => task.runTask(() => store.setSuggestionFeedback(contextId, suggestionId, change), "피드백을 저장하지 못했습니다."),
  };
}

export type ApplicationController = ReturnType<typeof useApplication>;

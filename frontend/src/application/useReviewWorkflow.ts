import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewNotFoundApiError } from "../domain/shared/errors";
import type { RetryModule } from "../domain/review/ports";
import type { PreparedReview } from "../domain/review/entities";
import type { WorkspaceRepository } from "../domain/workspace/ports";
import type { ApplicationServices } from "../domain/workspace/services";
import type { ReportError, RunTask } from "./useAsyncTask";

export function useReviewWorkflow({ store, services, activeRunId, runTask, reportError, onStarted }: {
  store: Pick<WorkspaceRepository, "prepareReview" | "prepareRetry" | "registerRun" | "clearActiveRun" | "completeReview">; services: Pick<ApplicationServices, "startReview" | "retryReview" | "followReview" | "getReviewRecord" | "releaseReview" | "cancelReview">; activeRunId?: string;
  runTask: RunTask; reportError: ReportError; onStarted: () => void;
}) {
  const [progress, setProgress] = useState("");
  const [delayed, setDelayed] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const following = useRef<{ runId: string; controller: AbortController } | null>(null);
  const mounted = useRef(false);
  const cancelling = useRef(false);
  const progressTimer = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
  const updateProgress = useCallback((message: string) => {
    window.clearTimeout(progressTimer.current);
    setProgress(message);
    setDelayed(false);
    progressTimer.current = message ? window.setTimeout(() => setDelayed(true), 8000) : undefined;
  }, []);

  async function registerRun(runId: string, input: PreparedReview) {
    try { await store.registerRun(runId, input); }
    catch (error) { await services.cancelReview(runId).catch(() => {}); throw error; }
    if (mounted.current) onStarted();
  }
  const beginReview = (contextId: string) => runTask(async () => {
    const input = await store.prepareReview(contextId);
    await registerRun(await services.startReview(input.kind, input.document, input.materials, undefined, input.reviewContext), input);
  }, "검토를 시작하지 못했습니다.");
  const retry = (reviewId: string, moduleKey: RetryModule) => runTask(async () => {
    const record = await store.prepareRetry(reviewId);
    const input: PreparedReview = { kind: "pages" in record.document ? "page" : "flow", document: record.document, materials: record.materials, reviewContext: record.reviewContext! };
    await registerRun((await services.retryReview(record, moduleKey)).runId, input);
  }, "검토를 다시 실행하지 못했습니다.");

  const finishRun = useCallback(async (runId: string) => {
    if (following.current?.runId === runId || !mounted.current) return;
    following.current?.controller.abort();
    const controller = new AbortController();
    const { signal } = controller;
    following.current = { runId, controller };
    setConnectionFailed(false);
    updateProgress("");
    let terminalEvent = "";
    try {
      try {
        await services.followReview(runId, event => {
          if (signal.aborted) return;
          terminalEvent = event.event;
          updateProgress(event.message);
        }, signal);
      } catch { /* Recover the terminal record after an interrupted event stream. */ }
      if (signal.aborted) return;
      if (terminalEvent === "cancelled") await store.clearActiveRun(runId);
      else {
        const record = await services.getReviewRecord(runId);
        if (signal.aborted) return;
        await store.completeReview(record);
      }
      // Once committed, release remains safe even if that commit unmounts the subscriber.
      await services.releaseReview(runId).catch(error => console.warn("Review cleanup failed", error));
    } catch (error) {
      if (!signal.aborted) {
        setConnectionFailed(true);
        reportError(error, "검토에 다시 연결해 주세요. 기존 결과는 유지됩니다.");
      }
    } finally {
      if (following.current?.controller === controller) following.current = null;
      if (!signal.aborted) updateProgress("");
    }
  }, [services, store, reportError, updateProgress]);

  async function cancelCurrent() {
    if (!activeRunId || cancelling.current) return;
    cancelling.current = true;
    try {
      await services.cancelReview(activeRunId);
      if (connectionFailed && mounted.current) await finishRun(activeRunId);
    } catch (error) {
      if (error instanceof ReviewNotFoundApiError) {
        try {
          await store.clearActiveRun(activeRunId);
          if (mounted.current) setConnectionFailed(false);
        } catch (storageError) {
          if (mounted.current) reportError(storageError, "검토 취소 상태를 저장하지 못했습니다.");
        }
      } else if (mounted.current) reportError(error, "검토를 취소하지 못했습니다.");
    } finally { cancelling.current = false; }
  }
  // The subscription is external; unmount detaches it without cancelling the persisted run.
  useEffect(() => {
    mounted.current = true;
    if (activeRunId) void finishRun(activeRunId);
    else { updateProgress(""); setConnectionFailed(false); }
    return () => {
      mounted.current = false;
      following.current?.controller.abort();
      following.current = null;
      window.clearTimeout(progressTimer.current);
    };
  }, [activeRunId, finishRun, updateProgress]);
  return { progress, delayed: !!progress && delayed, connectionFailed, beginReview, retry, cancelCurrent,
    reconnect: () => { if (activeRunId) void finishRun(activeRunId); } };
}

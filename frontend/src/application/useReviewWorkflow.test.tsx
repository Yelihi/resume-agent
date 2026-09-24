import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IndexedDbWorkspaceRepository } from "../infrastructure/workspace/IndexedDbWorkspaceRepository";
import { resumeInput, reviewRecord } from "../test/fixtures";
import type { ProgressEvent } from "../domain/review/ports";
import { defaultServices } from "../infrastructure/services";
import type { ApplicationServices } from "../domain/workspace/services";
import { useReviewWorkflow } from "./useReviewWorkflow";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}
async function prepare(overrides: Partial<ApplicationServices> = {}) {
  const store = new IndexedDbWorkspaceRepository(`workflow-${crypto.randomUUID()}`);
  const contextId = await store.createContext("Review", resumeInput());
  const input = await store.prepareReview(contextId);
  const record = reviewRecord(input);
  await store.registerRun(record.runId, input);
  const services = { ...defaultServices, followReview: vi.fn().mockResolvedValue(undefined),
    getReviewRecord: vi.fn().mockResolvedValue(record), releaseReview: vi.fn().mockResolvedValue(undefined), ...overrides };
  const reportError = vi.fn();
  const hook = () => useReviewWorkflow({ store, services, activeRunId: record.runId,
    runTask: action => action(), reportError, onStarted: vi.fn() });
  return { store, record, services, reportError, hook };
}
afterEach(() => vi.useRealTimers());

it("recovers a dropped completion event and releases only the locally committed record", async () => {
  const setup = await prepare({ followReview: vi.fn().mockRejectedValue(new Error("stream interrupted")) });
  const release = vi.spyOn(setup.services, "releaseReview").mockImplementation(async (runId: string) => {
    expect(setup.store.getSnapshot().reviews[0].id).toBe(runId);
    expect(setup.store.getSnapshot().activeRun).toBeUndefined();
  });
  renderHook(setup.hook);
  await waitFor(() => expect(release).toHaveBeenCalledOnce());
  expect(setup.reportError).not.toHaveBeenCalled();
});

it("retains a recoverable server record when local persistence fails", async () => {
  const setup = await prepare();
  vi.spyOn(setup.store, "completeReview").mockRejectedValue(new Error("storage full"));
  const { result } = renderHook(setup.hook);
  await waitFor(() => expect(result.current.connectionFailed).toBe(true));
  expect(setup.services.releaseReview).not.toHaveBeenCalled();
  expect(setup.store.getSnapshot().activeRun?.runId).toBe(setup.record.runId);
});

it("aborts only the event subscription on unmount and ignores late stream completion", async () => {
  const stream = deferred<void>();
  let signal: AbortSignal | undefined;
  const setup = await prepare({ followReview: vi.fn((_id, _progress, abortSignal?: AbortSignal) => {
    signal = abortSignal;
    return stream.promise;
  }) });
  const { unmount } = renderHook(setup.hook);
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { stream.resolve(); });
  expect(setup.services.getReviewRecord).not.toHaveBeenCalled();
  expect(setup.services.releaseReview).not.toHaveBeenCalled();
  expect(setup.store.getSnapshot().activeRun?.runId).toBe(setup.record.runId);
});

it("ignores a fetched record that arrives after the owner unmounts", async () => {
  const resultRecord = deferred<Awaited<ReturnType<ApplicationServices["getReviewRecord"]>>>();
  const setup = await prepare({ getReviewRecord: vi.fn(() => resultRecord.promise) });
  const complete = vi.spyOn(setup.store, "completeReview");
  const { unmount } = renderHook(setup.hook);
  await waitFor(() => expect(setup.services.getReviewRecord).toHaveBeenCalledOnce());
  unmount();
  await act(async () => { resultRecord.resolve(setup.record); });
  expect(complete).not.toHaveBeenCalled();
  expect(setup.services.releaseReview).not.toHaveBeenCalled();
});

it("resets the delayed notice for every progress event and avoids duplicate reconnects", async () => {
  let notify!: (event: ProgressEvent) => void;
  const setup = await prepare({ followReview: vi.fn((_id, onProgress) => { notify = onProgress; return new Promise<void>(() => {}); }) });
  vi.useFakeTimers();
  const { result, unmount } = renderHook(setup.hook);
  act(() => { notify({ event: "spellCheck", message: "Checking" }); });
  act(() => { vi.advanceTimersByTime(8000); });
  expect(result.current.delayed).toBe(true);
  act(() => { notify({ event: "spellCheck", message: "Checking" }); });
  expect(result.current.delayed).toBe(false);
  act(() => { result.current.reconnect(); result.current.reconnect(); });
  expect(setup.services.followReview).toHaveBeenCalledOnce();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps a run accepted after unmount recoverable without touching the old UI", async () => {
  const store = new IndexedDbWorkspaceRepository(`late-start-${crypto.randomUUID()}`);
  const contextId = await store.createContext("Review", resumeInput());
  const accepted = deferred<string>();
  const services = { ...defaultServices, startReview: vi.fn(() => accepted.promise), cancelReview: vi.fn() };
  const onStarted = vi.fn();
  const { result, unmount } = renderHook(() => useReviewWorkflow({ store, services,
    runTask: action => action(), reportError: vi.fn(), onStarted }));
  let start!: Promise<void>;
  act(() => { start = result.current.beginReview(contextId); });
  await waitFor(() => expect(services.startReview).toHaveBeenCalledOnce());
  unmount();
  await act(async () => { accepted.resolve("accepted-after-unmount"); await start; });
  expect(store.getSnapshot().activeRun?.runId).toBe("accepted-after-unmount");
  expect(onStarted).not.toHaveBeenCalled();
  expect(services.cancelReview).not.toHaveBeenCalled();
});

it("deduplicates cancellation while the server is still acknowledging it", async () => {
  const cancelled = deferred<Awaited<ReturnType<ApplicationServices["cancelReview"]>>>();
  const setup = await prepare({ followReview: vi.fn(() => new Promise<void>(() => {})), cancelReview: vi.fn(() => cancelled.promise) });
  const { result } = renderHook(setup.hook);
  let first!: Promise<void>;
  act(() => { first = result.current.cancelCurrent(); void result.current.cancelCurrent(); });
  expect(setup.services.cancelReview).toHaveBeenCalledOnce();
  await act(async () => { cancelled.resolve({ runId: setup.record.runId, cancelRequested: true }); await first; });
});

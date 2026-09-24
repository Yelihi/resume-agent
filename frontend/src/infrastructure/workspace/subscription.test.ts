import { renderHook, act } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IndexedDbWorkspaceRepository } from "./IndexedDbWorkspaceRepository";
import { useWorkspace, useWorkspaceSelector } from "../../hooks/useWorkspace";
import { materialDraft, resumeInput, reviewRecord, suggestion } from "../../test/fixtures";

const createStore = () => new IndexedDbWorkspaceRepository(`subscription-${crypto.randomUUID()}`);

it("publishes committed writes and keeps unchanged entities stable across refreshes", async () => {
  const store = createStore();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  expect(store.getLoaded()).toBe(false);
  const contextId = await store.createContext("First", resumeInput());
  expect(store.getLoaded()).toBe(true);
  expect(listener).toHaveBeenCalledTimes(1);
  const original = store.getSnapshot();
  await store.load();
  expect(store.getSnapshot()).toBe(original);
  expect(listener).toHaveBeenCalledTimes(1);
  await store.saveReviewFeedback(contextId, "Be concise");
  expect(store.getSnapshot().contexts[0].userFeedback).toBe("Be concise");
  expect(store.getSnapshot().resumeVersions).toBe(original.resumeVersions);
  expect(store.getSnapshot().resumeVersions[0].original).toBe(original.resumeVersions[0].original);
  unsubscribe();
  await store.saveReviewFeedback(contextId, "Another note");
  expect(listener).toHaveBeenCalledTimes(2);
});

it("rolls back every attachment and publishes nothing when one selected material is missing", async () => {
  const store = createStore();
  const contextId = await store.createContext("First", resumeInput());
  const materialId = await store.saveMaterial(materialDraft());
  const before = store.getSnapshot();
  const listener = vi.fn();
  store.subscribe(listener);
  await expect(store.attachMaterial(contextId, [materialId, "missing"])).rejects.toThrow();
  expect(store.getSnapshot()).toBe(before);
  expect(listener).not.toHaveBeenCalled();
  expect((await store.load()).contextMaterials).toEqual([]);
});

it("serializes competing resume updates and keeps the winning original", async () => {
  const store = createStore();
  const contextId = await store.createContext("First", resumeInput());
  const firstVersion = store.getSnapshot().contexts[0].latestVersionId;
  const outcomes = await Promise.allSettled([
    store.addResumeVersion(contextId, resumeInput("Winner"), firstVersion),
    store.addResumeVersion(contextId, resumeInput("Stale"), firstVersion),
  ]);
  expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "rejected"]);
  const workspace = await store.load();
  expect(workspace.resumeVersions).toHaveLength(2);
  expect(workspace.resumeVersions[1].original).toBe("Winner");
  expect(workspace.resumeVersions[0].original).toBeUndefined();
});

it("hydrates and follows injected store commits without app-owned copies", async () => {
  const store = createStore();
  const { result, unmount } = renderHook(() => useWorkspace(store));
  expect(result.current.loaded).toBe(false);
  await act(async () => { await result.current.refresh(); });
  expect(result.current.loaded).toBe(true);
  await act(async () => { await store.createContext("From outside component", resumeInput()); });
  expect(result.current.workspace.contexts[0].name).toBe("From outside component");
  unmount();
});

it("retains original Blob identity when a different workspace changes", async () => {
  const store = createStore();
  const input = { ...resumeInput(), inputType: "file" as const, original: new Blob(["original PDF"], { type: "application/pdf" }) };
  await store.createContext("Original", input);
  const originalVersion = store.getSnapshot().resumeVersions[0];
  await store.createContext("Other", resumeInput());
  expect(store.getSnapshot().resumeVersions.find(version => version.id === originalVersion.id)).toBe(originalVersion);
  expect(originalVersion.original).toBeDefined();
});

it("refreshes changes from a second store instance and cannot regress after overlapping loads", async () => {
  const name = `two-instances-${crypto.randomUUID()}`;
  const first = new IndexedDbWorkspaceRepository(name), second = new IndexedDbWorkspaceRepository(name);
  const contextId = await first.createContext("Shared", resumeInput());
  await second.load();
  const read = first.load();
  await second.saveReviewFeedback(contextId, "Changed elsewhere");
  await Promise.all([read, first.load(), first.load()]);
  expect(first.getSnapshot().contexts[0].userFeedback).toBe("Changed elsewhere");
});


it("does not rerender a resume subscriber when only feedback changes", async () => {
  const store = createStore();
  const contextId = await store.createContext("First", resumeInput());
  const render = vi.fn();
  const { result } = renderHook(() => {
    render();
    return useWorkspaceSelector(store, workspace => workspace.resumeVersions[0]);
  });
  const original = result.current;
  const renders = render.mock.calls.length;
  await act(async () => { await store.saveReviewFeedback(contextId, "Only feedback"); });
  expect(result.current).toBe(original);
  expect(render).toHaveBeenCalledTimes(renders);
});


it("preserves a pending run and its data when a malformed completion fails halfway through", async () => {
  const store = createStore();
  const contextId = await store.createContext("First", resumeInput());
  const input = await store.prepareReview(contextId);
  const duplicate = suggestion();
  const record = reviewRecord(input, [duplicate, duplicate]);
  await store.registerRun(record.runId, input);
  const before = store.getSnapshot();
  await expect(store.completeReview(record)).rejects.toThrow("중복된 제안 식별자");
  expect(store.getSnapshot()).toBe(before);
  const persisted = await store.load();
  expect(persisted.activeRun?.runId).toBe(record.runId);
  expect(persisted.suggestions).toEqual([]);
  expect(persisted.reviews).toEqual([]);
});

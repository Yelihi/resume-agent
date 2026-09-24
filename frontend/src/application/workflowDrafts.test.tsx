import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IndexedDbWorkspaceRepository } from "../infrastructure/workspace/IndexedDbWorkspaceRepository";
import { resumeInput } from "../test/fixtures";
import { defaultServices } from "../infrastructure/services";
import { useMaterialsWorkflow } from "./useMaterialsWorkflow";
import { useResumeWorkflow } from "./useResumeWorkflow";

const policy = { maximumFileSizeBytes: { pdf: 1000, image: 1000, docx: 1000, txt: 1000 }, maximumDirectTextCharacters: 1000 };
const runTask = (action: () => Promise<void>) => action();
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  return { promise: new Promise<Value>(done => { resolve = done; }), resolve: (value: Value) => resolve(value) };
}
it("does not replace a new material editor with a discarded extraction result", async () => {
  const store = new IndexedDbWorkspaceRepository(`material-draft-${crypto.randomUUID()}`);
  const extracted = deferred<{ content: string; sources: string[] }>();
  const services = { ...defaultServices, previewMaterial: vi.fn(() => extracted.promise) };
  const { result } = renderHook(() => useMaterialsWorkflow({ store, workspace: store.getSnapshot(), services,
    resolvePolicy: async () => policy, runTask, confirm: () => true }));
  act(() => { result.current.openEditor(); });
  act(() => { result.current.updateEditor({ input: "https://example.com/job", title: "Old" }); });
  let extraction!: Promise<void>;
  await act(async () => { extraction = result.current.extractMaterial(); });
  act(() => { result.current.reset(); result.current.openEditor(); });
  act(() => { result.current.updateEditor({ title: "New" }); });
  await act(async () => { extracted.resolve({ content: "Old extracted text", sources: [] }); await extraction; });
  expect(result.current.editor?.title).toBe("New");
  expect(result.current.editor?.previewed).toBe(false);
});

it.each(["reset", "unmount"])("does not save or navigate from a resume extraction after %s", async action => {
  const store = new IndexedDbWorkspaceRepository(`resume-draft-${crypto.randomUUID()}`);
  const extracted = deferred<ReturnType<typeof resumeInput>["document"]>();
  const services = { ...defaultServices, extractText: vi.fn(async () => await extracted.promise as Awaited<ReturnType<typeof defaultServices.extractText>>) };
  const onSaved = vi.fn();
  const { result, unmount } = renderHook(() => useResumeWorkflow({ store, services,
    resolvePolicy: async () => policy, runTask, onSaved }));
  act(() => { result.current.updateDraft({ inputMode: "text", text: "Original", contextName: "Old" }); });
  let extraction!: Promise<void>;
  await act(async () => { extraction = result.current.saveResume(); });
  if (action === "unmount") unmount(); else act(() => result.current.reset());
  await act(async () => { extracted.resolve(resumeInput().document); await extraction; });
  expect(store.getSnapshot().contexts).toEqual([]);
  expect(onSaved).not.toHaveBeenCalled();
});

it("does not clear a replacement material draft when an earlier save commits", async () => {
  const store = new IndexedDbWorkspaceRepository(`material-save-${crypto.randomUUID()}`);
  const saved = deferred<string>();
  vi.spyOn(store, "saveMaterial").mockImplementation(() => saved.promise);
  const { result } = renderHook(() => useMaterialsWorkflow({ store, workspace: store.getSnapshot(), services: defaultServices,
    resolvePolicy: async () => policy, runTask, confirm: () => true }));
  act(() => { result.current.openEditor(); });
  act(() => { result.current.updateEditor({ title: "Old", content: "Ready", previewed: true }); });
  let saving!: Promise<void>;
  await act(async () => { saving = result.current.saveMaterial(); });
  act(() => { result.current.reset(); result.current.openEditor(); });
  act(() => { result.current.updateEditor({ title: "New" }); });
  await act(async () => { saved.resolve("saved-material"); await saving; });
  expect(result.current.editor?.title).toBe("New");
});

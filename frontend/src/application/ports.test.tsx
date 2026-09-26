import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { WorkspaceRepository } from "../domain/workspace/ports";
import type { ResumeGateway } from "../domain/resume/ports";
import { useResumeWorkflow } from "./useResumeWorkflow";
import { resumeInput } from "../test/fixtures";
import type { FlowDocument } from "../domain/resume/contracts";

const policy = { maximumFileSizeBytes: { pdf: 1000, image: 1000, docx: 1000, txt: 1000 }, maximumDirectTextCharacters: 1000 };

function setup() {
  const document = resumeInput("검증된 내용").document as FlowDocument;
  const store = { createContext: vi.fn(async () => "new-context"), addResumeVersion: vi.fn(async () => {}) } satisfies Pick<WorkspaceRepository, "createContext" | "addResumeVersion">;
  const services = { extractText: vi.fn(async () => document), extractFile: vi.fn<ResumeGateway["extractFile"]>() } satisfies Pick<ResumeGateway, "extractText" | "extractFile">;
  const onSaved = vi.fn();
  const hook = renderHook(() => useResumeWorkflow({ store, services, resolvePolicy: async () => policy, runTask: action => action(), onSaved }));
  act(() => hook.result.current.updateDraft({ inputMode: "text", text: "원문", contextName: "지원" }));
  return { ...hook, store, services, document, onSaved };
}

it("orchestrates extraction and persistence using plain port fakes without IndexedDB or HTTP", async () => {
  const { result, store, services, document, onSaved } = setup();
  await act(async () => { await result.current.saveResume(); });
  expect(services.extractText).toHaveBeenCalledWith("원문");
  expect(store.createContext).not.toHaveBeenCalled();
  await act(async () => { await result.current.confirmExtraction(); });
  expect(store.createContext).toHaveBeenCalledWith("지원", expect.objectContaining({ original: "원문", document }));
  expect(onSaved).toHaveBeenCalledWith("new-context");
});

it("preserves a draft and does not navigate when the injected repository rejects a write", async () => {
  const { result, store, onSaved } = setup();
  store.createContext.mockRejectedValueOnce(new Error("storage unavailable"));
  await act(async () => { await result.current.saveResume(); });
  await act(async () => { await expect(result.current.confirmExtraction()).rejects.toThrow("storage unavailable"); });
  expect(result.current.pendingResume).not.toBeNull();
  expect(result.current.processingStage).toBeNull();
  expect(result.current.draft.text).toBe("원문");
  expect(onSaved).not.toHaveBeenCalled();
});

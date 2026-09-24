import { createTestRouter } from "./test/router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { IndexedDbWorkspaceRepository } from "./infrastructure/workspace/IndexedDbWorkspaceRepository";
import { materialDraft, resumeInput, reviewRecord, suggestion } from "./test/fixtures";
import type { ReviewRecord } from "./domain/review/contracts";

async function setup(overrides = {}) {
  const store = new IndexedDbWorkspaceRepository(`lifecycle-${crypto.randomUUID()}`);
  const id = await store.createContext("작업 A", resumeInput());
  const input = await store.prepareReview(id); const record = reviewRecord(input);
  const services = { getValidationPolicy: vi.fn().mockResolvedValue({ maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 }, maximumDirectTextCharacters: 100 }),
    startReview: vi.fn().mockResolvedValue(record.runId), followReview: vi.fn().mockImplementation(async (_id, progress) => progress({ event: "completed", message: "완료" })),
    getReviewRecord: vi.fn().mockResolvedValue(record), releaseReview: vi.fn().mockResolvedValue(undefined), ...overrides };
  window.history.replaceState(null, "", `/contexts/${id}`);
  return { store, id, record, services };
}
it("releases server state after the IndexedDB transaction commits", async () => {
  const { store, services } = await setup();
  services.releaseReview.mockImplementation(async () => { expect((await store.load()).reviews).toHaveLength(1); });
  render(<App router={createTestRouter()} store={store} services={services} />);
  await userEvent.click(await screen.findByRole("button", { name: "이력서 검토하기" }));
  await waitFor(() => expect(services.releaseReview).toHaveBeenCalled());
  expect((await store.load()).activeRun).toBeUndefined();
});
it("keeps the run and server result when saving fails", async () => {
  const { store, services } = await setup();
  vi.spyOn(store, "completeReview").mockRejectedValue(new Error("저장 공간 부족"));
  render(<App router={createTestRouter()} store={store} services={services} />);
  await userEvent.click(await screen.findByRole("button", { name: "이력서 검토하기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("저장 공간 부족");
  expect(services.releaseReview).not.toHaveBeenCalled();
  expect((await store.load()).activeRun).toBeDefined();
});
it("reads local results without a running backend", async () => {
  const { store, id, record, services } = await setup({ getValidationPolicy: vi.fn().mockRejectedValue(new Error("offline")) });
  await store.registerRun(record.runId, await store.prepareReview(id)); await store.completeReview(record);
  render(<App router={createTestRouter()} store={store} services={services} />);
  expect(await screen.findByText("본인의 역할을 구체적으로 작성하세요.")).toBeInTheDocument();
  expect(services.followReview).not.toHaveBeenCalled();
});
it("cancel unlocks the context without adding a review result", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const cancelReview = vi.fn().mockImplementation(async () => { finish(); });
  const { store, services } = await setup({ cancelReview, followReview: vi.fn().mockImplementation(async (_id, progress) => {
    progress({ event: "finalReview", message: "검토 중" }); await pending; progress({ event: "cancelled", message: "취소" });
  }) });
  render(<App router={createTestRouter()} store={store} services={services} />);
  await userEvent.click(await screen.findByRole("button", { name: "이력서 검토하기" }));
  await userEvent.click(await screen.findByRole("button", { name: "검토 취소" }));
  await waitFor(async () => expect((await store.load()).activeRun).toBeUndefined());
  expect((await store.load()).reviews).toEqual([]);
});

async function partialReviewSetup() {
  const { store, id, services } = await setup();
  const material = await store.saveMaterial(materialDraft("검토 당시 채용 자료"), undefined, id);
  const input = await store.prepareReview(id);
  const record = reviewRecord(input);
  const error = { moduleKey: "jobPostingAnalysis", inputSourceId: null, errorCode: "TEMPORARY_FAILURE", userMessage: "채용 자료 분석을 다시 시도해 주세요.", canRetry: true };
  record.response.status = "partial";
  record.response.errors = [error];
  record.moduleResults.jobPostingAnalysis = { moduleKey: "jobPostingAnalysis", output: null, errors: [error] };
  await store.registerRun(record.runId, input);
  await store.completeReview(record);
  return { store, id, services, input, record, material };
}

it("retries an error from the header without requiring decisions on open proposals", async () => {
  const { store, services, input } = await partialReviewSetup();
  const completed = reviewRecord(input);
  services.getReviewRecord.mockResolvedValue(completed);
  const retryReview = vi.fn().mockResolvedValue({ runId: completed.runId });
  render(<App router={createTestRouter()} store={store} services={{ ...services, retryReview }} />);
  const button = await screen.findByRole("button", { name: "모듈 다시 실행" });
  expect(button.closest("header")).not.toBeNull();
  await userEvent.click(button);
  await waitFor(() => expect(services.releaseReview).toHaveBeenCalled());
  expect(retryReview.mock.calls[0][0].reviewContext.feedback).toEqual([]);
  expect(screen.queryByRole("button", { name: "모듈 다시 실행" })).not.toBeInTheDocument();
});

it("retries pinned inputs with current Skip and rating feedback without reviving the skipped proposal", async () => {
  const { store, id, services, input, record, material } = await partialReviewSetup();
  await store.addResumeVersion(id, resumeInput("새로 업로드한 이력서"), input.reviewContext.resumeVersionId);
  await store.saveMaterial(materialDraft("갱신된 채용 자료"), material, undefined, input.reviewContext.materialVersions![material]);
  let completed!: ReviewRecord;
  const retryReview = vi.fn().mockImplementation(async (request: ReviewRecord) => {
    const skipped = request.reviewContext?.feedback?.some(item => item.id === record.response.results[0].id && item.decision === "skip");
    completed = reviewRecord({ kind: input.kind, document: request.document, materials: request.materials, reviewContext: request.reviewContext! }, skipped ? [] : [suggestion()]);
    return { runId: completed.runId };
  });
  services.getReviewRecord.mockImplementation(async () => completed);
  render(<App router={createTestRouter()} store={store} services={{ ...services, retryReview }} />);
  await userEvent.click(await screen.findByRole("button", { name: "제안 1 싫어요" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "제안 1 싫어요" })).toHaveAttribute("aria-pressed", "true"));
  await userEvent.click(screen.getByRole("button", { name: "제안 1 Skip" }));
  await waitFor(() => expect(screen.queryByText("본인의 역할을 구체적으로 작성하세요.")).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "모듈 다시 실행" }));
  await waitFor(() => expect(services.releaseReview).toHaveBeenCalled());
  const [request, moduleKey] = retryReview.mock.calls[0];
  expect(moduleKey).toBe("jobPostingAnalysis");
  expect(request.document).toEqual(input.document);
  expect(request.materials).toEqual(input.materials);
  expect(request.reviewContext).toMatchObject({ resumeVersionId: input.reviewContext.resumeVersionId, materialVersions: input.reviewContext.materialVersions,
    feedback: [expect.objectContaining({ id: record.response.results[0].id, decision: "skip", rating: "down" })] });
  expect(screen.queryByText("본인의 역할을 구체적으로 작성하세요.")).not.toBeInTheDocument();
  expect((await store.load()).suggestions.find(item => item.id === record.response.results[0].id)).toMatchObject({ decision: "skip", rating: "down" });
});

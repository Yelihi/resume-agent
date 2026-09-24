import { createTestRouter } from "./test/router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { IndexedDbWorkspaceRepository } from "./infrastructure/workspace/IndexedDbWorkspaceRepository";
import { resumeInput, reviewRecord } from "./test/fixtures";

async function renderSavedReview(canRetry?: boolean) {
  const store = new IndexedDbWorkspaceRepository(`regression-${crypto.randomUUID()}`);
  const contextId = await store.createContext("지원", resumeInput());
  const input = await store.prepareReview(contextId);
  const record = reviewRecord(input);
  if (canRetry !== undefined) {
    record.response.status = "partial";
    record.response.errors = [0, 1].map(() => ({ moduleKey: "finalReview", inputSourceId: null, errorCode: "QUOTE_MISMATCH", userMessage: "인용을 확인할 수 없습니다.", canRetry }));
  }
  await store.registerRun(record.runId, input);
  await store.completeReview(record);
  const saveFeedback = vi.spyOn(store, "setSuggestionFeedback");
  window.history.replaceState(null, "", `/contexts/${contextId}`);
  render(<App router={createTestRouter()} store={store} services={{ getValidationPolicy: vi.fn().mockResolvedValue({ maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 }, maximumDirectTextCharacters: 100 }) }} />);
  await screen.findByRole("button", { name: "제안 1 Resolve" });
  return { record, saveFeedback };
}

it("allows quote navigation in historical results but prohibits feedback and module retries", async () => {
  const { record, saveFeedback } = await renderSavedReview(true);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "검토 기록" }), record.runId);
  for (const name of ["제안 1 좋아요", "제안 1 싫어요", "제안 1 Resolve", "제안 1 Skip"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toBeDisabled();
    await userEvent.click(button);
  }
  expect(saveFeedback).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "모듈 다시 실행" })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "다음 검토에 반영할 의견" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "경력 한 줄 제안 보기" }));
  expect(screen.getByText("경력 한 줄", { selector: "span[data-line-id]" })).toHaveAttribute("data-selected", "true");
});

it.each([undefined, false])("does not offer retry without a retryable error (%s)", async canRetry => {
  await renderSavedReview(canRetry);
  expect(screen.queryByRole("button", { name: "모듈 다시 실행" })).not.toBeInTheDocument();
  if (canRetry === false) expect(within(screen.getByLabelText("검토 오류")).getAllByRole("listitem")).toHaveLength(1);
});

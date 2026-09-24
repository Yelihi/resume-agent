import { createTestRouter } from "./test/router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { IndexedDbWorkspaceRepository } from "./infrastructure/workspace/IndexedDbWorkspaceRepository";
import { materialDraft, resumeInput, reviewRecord } from "./test/fixtures";

async function setup() {
  const store = new IndexedDbWorkspaceRepository(`results-${crypto.randomUUID()}`);
  const id = await store.createContext("지원 A", resumeInput());
  const input = await store.prepareReview(id); const record = reviewRecord(input);
  await store.registerRun(record.runId, input); await store.completeReview(record);
  window.history.replaceState(null, "", `/contexts/${id}`);
  render(<App router={createTestRouter()} store={store} services={{ getValidationPolicy: vi.fn().mockResolvedValue({ maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 }, maximumDirectTextCharacters: 100 }) }} />);
  await screen.findByText("본인의 역할을 구체적으로 작성하세요.");
  return { store, id };
}
it("shows one latest card and independently records thumbs and decisions", async () => {
  const { store } = await setup();
  expect(screen.getByRole("button", { name: "이력서 검토하기" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "제안 1 싫어요" }));
  expect((await store.load()).suggestions[0].decision).toBe("open");
  await userEvent.click(screen.getByRole("button", { name: "제안 1 Resolve" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "이력서 검토하기" })).toBeEnabled());
  expect((await store.load()).suggestions[0].rating).toBe("down");
});
it("hides skipped cards while retaining their exclusion memory", async () => {
  const { store, id } = await setup();
  await userEvent.click(screen.getByRole("button", { name: "제안 1 Skip" }));
  await waitFor(() => expect(screen.queryByText("본인의 역할을 구체적으로 작성하세요.")).not.toBeInTheDocument());
  expect((await store.prepareReview(id)).reviewContext.feedback?.[0].decision).toBe("skip");
});
it("highlights the source and persists context feedback", async () => {
  const { store, id } = await setup();
  await userEvent.click(screen.getByRole("button", { name: "경력 한 줄 제안 보기" }));
  expect(screen.getByText("경력 한 줄", { selector: "span[data-line-id]" })).toHaveAttribute("data-selected", "true");
  await userEvent.type(screen.getByLabelText("다음 검토에 반영할 의견"), "간결하게");
  await userEvent.click(screen.getByRole("button", { name: "의견 저장" }));
  await waitFor(async () => expect((await store.load()).contexts.find(c => c.id === id)?.userFeedback).toBe("간결하게"));
});

it("shows separate posting summaries using the versions pinned to the review", async () => {
  const store = new IndexedDbWorkspaceRepository(`summaries-${crypto.randomUUID()}`);
  const id = await store.createContext("지원", resumeInput());
  const first = await store.saveMaterial({ ...materialDraft(), title: "공고 A", source: "A 사이트" }, undefined, id);
  const second = await store.saveMaterial({ ...materialDraft(), title: "공고 B", source: "B 사이트" }, undefined, id);
  const input = await store.prepareReview(id);
  const record = reviewRecord(input);
  record.moduleResults.jobPostingAnalysis!.output = { summary: "프론트엔드 채용 종합", evidence: [
    { sourceId: first, statement: "표시하지 않을 상세 분석 근거" },
  ], materialSummaries: [
    { sourceId: first, summary: "A는 React 필수" }, { sourceId: second, summary: "B는 접근성 경험 우대" },
  ] };
  record.response.materialReviews = [{ sourceId: first, materialType: "jobPosting", status: "applied", reason: "React 경험을 제안에 반영했습니다." }];
  await store.registerRun(record.runId, input);
  await store.completeReview(record);
  await store.saveMaterial({ ...materialDraft(), title: "변경된 공고 A" }, first, undefined, input.reviewContext.materialVersions![first]);
  window.history.replaceState(null, "", `/contexts/${id}`);
  render(<App router={createTestRouter()} store={store} services={{ getValidationPolicy: vi.fn().mockResolvedValue({ maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 }, maximumDirectTextCharacters: 100 }) }} />);
  const summaries = await screen.findByLabelText("공고 자료별 요약");
  expect(summaries).toHaveTextContent("프론트엔드 채용 종합");
  const firstSummary = within(summaries).getByText("공고 A").closest("section")!;
  expect(firstSummary).toHaveTextContent("A는 React 필수");
  expect(firstSummary).toHaveTextContent("React 경험을 제안에 반영했습니다.");
  expect(summaries).not.toHaveTextContent("표시하지 않을 상세 분석 근거");
  expect(screen.queryByLabelText("검토 자료 반영 결과")).not.toBeInTheDocument();
  expect(firstSummary).not.toHaveTextContent("B는 접근성 경험 우대");
  expect(summaries).toHaveTextContent("공고 B");
  expect(summaries).not.toHaveTextContent("변경된 공고 A");
});

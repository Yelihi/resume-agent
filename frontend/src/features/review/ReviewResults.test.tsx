import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ReviewResults, type ReviewResultsProps } from "./ReviewResults";
import { suggestion } from "../../test/fixtures";

function props(): ReviewResultsProps {
  return { suggestions: [{ id: "suggestion", contextId: "context", reviewId: "review", resumeVersionId: "resume", content: suggestion(), rating: null, decision: "open" }],
    materialVersions: [], viewedResumeVersionId: "resume", historical: false, locked: false, running: false, progress: "", delayed: false, connectionFailed: false,
    initialFeedback: "저장된 의견", onFeedbackSave: vi.fn(), onSuggestionChange: vi.fn(), onSelectQuote: vi.fn() };
}

it("keeps feedback local until save and preserves the draft across unrelated wrapper updates", async () => {
  const input = props();
  const { rerender } = render(<ReviewResults {...input} />);
  const feedback = screen.getByRole("textbox", { name: "다음 검토에 반영할 의견" });
  await userEvent.clear(feedback);
  await userEvent.type(feedback, "수정 의견");
  rerender(<ReviewResults {...input} progress="진행 변경" />);
  expect(feedback).toHaveValue("수정 의견");
  expect(input.onFeedbackSave).not.toHaveBeenCalled();
  rerender(<ReviewResults {...input} running progress="분석 중" />);
  expect(screen.queryByRole("textbox", { name: "다음 검토에 반영할 의견" })).not.toBeInTheDocument();
  rerender(<ReviewResults {...input} />);
  expect(feedback).toHaveValue("수정 의견");
  await userEvent.click(screen.getByRole("button", { name: "의견 저장" }));
  expect(input.onFeedbackSave).toHaveBeenCalledWith("수정 의견");
});

it("exposes quote navigation to keyboard users and delegates exact feedback changes", async () => {
  const input = props();
  render(<ReviewResults {...input} />);
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "경력 한 줄 제안 보기" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(input.onSelectQuote).toHaveBeenCalledWith(["f-l1"], 1);
  await userEvent.click(screen.getByRole("button", { name: "제안 1 좋아요" }));
  expect(input.onSuggestionChange).toHaveBeenCalledWith(input.suggestions[0], { rating: "up" });
});

it("disables source navigation when the visible resume differs and presents busy progress", () => {
  const input = props();
  const { rerender } = render(<ReviewResults {...input} viewedResumeVersionId="another-version" />);
  expect(screen.getByRole("button", { name: "경력 한 줄 제안 보기" })).toBeDisabled();
  rerender(<ReviewResults {...input} running progress="분석 중" delayed />);
  expect(screen.getByRole("status")).toHaveTextContent("검토가 예상보다 오래 걸리고 있습니다.");
  expect(screen.getByLabelText("분석 제안 생성 중")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByRole("button", { name: "제안 1 Resolve" })).not.toBeInTheDocument();
});

it("keeps original numbering in the style filter and shows a question instead of a rewrite", async () => {
  const input = props();
  const first = input.suggestions[0];
  input.suggestions.push({ ...first, id: "style", content: { ...first.content,
    diagnostic: { category: "writing-style", ruleId: "contribution", action: "ask" },
    "이유 및 제안": "직접 변경한 부분은 무엇인가요?", "실제 수정 예시": "[확인 필요]" } });
  render(<ReviewResults {...input} />);
  await userEvent.click(screen.getByRole("button", { name: "문체" }));
  expect(screen.getByText("확인할 내용")).toBeVisible();
  expect(screen.queryByText("[확인 필요]")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "경력 한 줄 제안 보기" }));
  expect(input.onSelectQuote).toHaveBeenCalledWith(["f-l1"], 2);
});

it("shows unconfirmed requirements under the pinned posting, outside suggestion cards", () => {
  const input = props();
  input.suggestions = [];
  input.materialVersions = [{ id: "v", materialId: "job", version: 1, createdAt: "2026-01-01", title: "검토 당시 공고",
    materialType: "jobPosting", content: "장애 대응", source: "직접 입력" }];
  input.attempt = { id: "r", contextId: "c", resumeVersionId: "resume", createdAt: "2026-01-01",
    input: { contextId: "c", resumeVersionId: "resume", feedback: [], materialVersions: { job: "v" } },
    modules: { spellCheck: { moduleKey: "spellCheck", output: [], errors: [] } },
    finalErrors: [], finalFailed: false, materialReviews: [{sourceId: "job", materialType: "jobPosting", status: "applied", reason: "검토함"}],
    errors: [], status: "success", resolutionChecks: [], resultIds: [], suggestionIds: [],
    requirementAssessments: [{sourceId: "job", requirement: "장애 대응", reason: "자료에서 확인되지 않습니다.", status: "unconfirmed", resumeEvidence: [], experienceEvidence: []}] };
  const saved = input.attempt;
  input.displayReview = saved;
  input.attempt = { ...saved, id: "failed", status: "failed", requirementAssessments: [], materialReviews: [] };
  render(<ReviewResults {...input} />);
  expect(screen.getByText(/기존 제안은 유지됩니다/)).toBeVisible();
  expect(screen.getByRole("region", {name: "검토 당시 공고 요구사항별 근거"})).toHaveTextContent("자료에서 확인되지 않음");
  expect(screen.queryByRole("button", {name: /Resolve/})).not.toBeInTheDocument();
});

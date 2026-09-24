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
  expect(screen.getByRole("status")).toHaveTextContent("조금 더 꼼꼼히 확인하고 있습니다.");
  expect(screen.getByLabelText("분석 제안 생성 중")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByRole("button", { name: "제안 1 Resolve" })).not.toBeInTheDocument();
});

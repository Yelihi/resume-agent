import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { resumeInput } from "../test/fixtures";
import { ExtractionPreview } from "./ExtractionPreview";

it("requires explicit confirmation and prevents cancellation while saving", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const input = resumeInput();
  const { rerender } = render(<ExtractionPreview input={input} busy={false} onCancel={onCancel} onConfirm={onConfirm} />);
  expect(screen.getByRole("button", { name: "확인 후 저장" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "확인 후 저장" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  rerender(<ExtractionPreview input={input} busy onCancel={onCancel} onConfirm={onConfirm} />);
  const cancel = new Event("cancel", { cancelable: true });
  fireEvent(screen.getByRole("dialog"), cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
});

it("selects the cited source line and shows the flow-document limitation", async () => {
  const input = resumeInput("원본 확인 문장");
  input.document.extraction = { status: "needs_review", confirmed: false, issues: [{ stage: "assessment", code: "LOW_OCR_CONFIDENCE", message: "원본 확인 필요", recovered: false, lineIds: ["f-l1"] }] };
  render(<ExtractionPreview input={input} busy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "원본 확인 문장" }));
  expect(document.querySelector('[data-line-id="f-l1"]')).toHaveAttribute("data-selected", "true");
  expect(screen.getByText(/DOCX·TXT 원본 파일/)).toBeInTheDocument();
});

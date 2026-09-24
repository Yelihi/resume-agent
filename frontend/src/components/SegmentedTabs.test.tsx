import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SegmentedTabs } from "./SegmentedTabs";

const options = [{ value: "all", label: "전체" }, { value: "company", label: "회사 자료" }, { value: "jobPosting", label: "채용 공고" }] as const;
function Example() {
  const [value, setValue] = useState<(typeof options)[number]["value"]>("all");
  return <><SegmentedTabs id="materials" label="자료 종류" value={value} options={options} onChange={setValue} />
    <div role="tabpanel" id="materials-panel" aria-labelledby={`materials-${value}`}>결과</div><button>다음 영역</button></>;
}

it("uses one tab stop and activates tabs with wrapping arrows, Home, and End", async () => {
  render(<Example />);
  await userEvent.tab();
  expect(screen.getByRole("tab", { name: "전체" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "채용 공고" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "채용 공고" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel", { name: "채용 공고" })).toHaveAttribute("id", "materials-panel");
  await userEvent.keyboard("{ArrowRight}{ArrowRight}");
  expect(screen.getByRole("tab", { name: "회사 자료" })).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "채용 공고" })).toHaveFocus();
  await userEvent.keyboard("{Home}");
  expect(screen.getByRole("tab", { name: "전체" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "회사 자료" })).toHaveAttribute("tabindex", "-1");
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "다음 영역" })).toHaveFocus();
});

it("selects by pointer and prevents changes when disabled", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<SegmentedTabs id="materials" label="자료 종류" value="all" options={options} onChange={onChange} />);
  await userEvent.click(screen.getByRole("tab", { name: "회사 자료" }));
  expect(onChange).toHaveBeenCalledWith("company");
  onChange.mockClear();
  rerender(<SegmentedTabs id="materials" label="자료 종류" value="all" options={options} onChange={onChange} disabled />);
  for (const tab of screen.getAllByRole("tab")) {
    expect(tab).toBeDisabled();
    await userEvent.click(tab);
  }
  expect(onChange).not.toHaveBeenCalled();
});

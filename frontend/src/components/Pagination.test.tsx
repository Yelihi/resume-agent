import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Pagination } from "./Pagination";
import { usePagination } from "../hooks/usePagination";
function List({ count }: { count: number }) {
  const pagination = usePagination(Array.from({ length: count }, (_, index) => index));
  return <><ul>{pagination.items.map(item => <li key={item}>{item}</li>)}</ul><Pagination label="목록 페이지" page={pagination.page} pageCount={pagination.pageCount} onPageChange={pagination.setPage} /></>;
}
it("supports keyboard page changes and clamps the page after deletion", async () => {
  const { rerender } = render(<List count={25} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(12);
  expect(screen.getByRole("button", { name: "이전 페이지" })).toBeDisabled();
  screen.getByRole("button", { name: "3페이지" }).focus();
  await userEvent.keyboard("{Enter}");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "3페이지" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "다음 페이지" })).toBeDisabled();
  rerender(<List count={24} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(12);
  expect(screen.getByRole("button", { name: "2페이지" })).toHaveAttribute("aria-current", "page");
});

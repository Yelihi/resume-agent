import { StrictMode, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { ErrorPopup } from "./ErrorPopup";
import { ClientApplicationError } from "../infrastructure/http/client";

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, descriptor] of [["showModal", originalShowModal], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

function mockNativeDialog() {
  const showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
    this.querySelector<HTMLButtonElement>("button")?.focus();
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
  return showModal;
}

it("opens natively and restores trigger focus after Escape in StrictMode", async () => {
  const showModal = mockNativeDialog();
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>열기</button>{open && <Dialog labelledBy="title" onDismiss={() => setOpen(false)}><h2 id="title">테스트</h2><button>내부</button></Dialog>}</>;
  }
  render(<StrictMode><Example /></StrictMode>);
  await userEvent.click(screen.getByRole("button", { name: "열기" }));
  expect(showModal).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "내부" })).toHaveFocus();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "열기" })).toHaveFocus();
});

it("does not dismiss a busy dialog and uses the current callback after rerender", () => {
  const onDismiss = vi.fn();
  const nextDismiss = vi.fn();
  const { rerender } = render(<Dialog labelledBy="title" busy onDismiss={onDismiss}><h2 id="title">저장</h2></Dialog>);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(onDismiss).not.toHaveBeenCalled();
  rerender(<Dialog labelledBy="title" onDismiss={nextDismiss}><h2 id="title">저장</h2></Dialog>);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(nextDismiss).toHaveBeenCalledOnce();
});

it("shows error details and calls dismissal exactly once per action", async () => {
  const onClose = vi.fn();
  const error = new ClientApplicationError("연결 실패", [], 0, "NETWORK_ERROR");
  const { rerender } = render(<ErrorPopup error={null} onClose={onClose} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(<ErrorPopup error={error} onClose={onClose} />);
  expect(screen.getByRole("alert")).toHaveTextContent("연결 실패");
  expect(screen.getByText("NETWORK_ERROR")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "확인" }));
  expect(onClose).toHaveBeenCalledOnce();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("closing a stacked error returns focus to the underlying editor without dismissing it", async () => {
  mockNativeDialog();
  function EditorWithError() {
    const [error, setError] = useState<ClientApplicationError | null>(null);
    return <>
      <Dialog label="편집" onDismiss={() => {}}><button onClick={() => setError(new ClientApplicationError("저장 실패", [], 0))}>저장</button></Dialog>
      <ErrorPopup error={error} onClose={() => setError(null)} />
    </>;
  }
  render(<EditorWithError />);
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(screen.getByRole("dialog", { name: "요청 오류" })).toHaveAttribute("open");
  await userEvent.click(screen.getByRole("button", { name: "확인" }));
  expect(screen.queryByRole("dialog", { name: "요청 오류" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "편집" })).toHaveAttribute("open");
  expect(screen.getByRole("button", { name: "저장" })).toHaveFocus();
});

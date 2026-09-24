import { createTestRouter } from "./test/router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { IndexedDbWorkspaceRepository } from "./infrastructure/workspace/IndexedDbWorkspaceRepository";

it("retains an unsaved resume when navigation is rejected, and clears it after acceptance", async () => {
  window.history.replaceState(null, "", "/contexts/new");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<App router={createTestRouter()} store={new IndexedDbWorkspaceRepository(`navigation-${crypto.randomUUID()}`)} services={{ getValidationPolicy: vi.fn().mockResolvedValue({ maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 }, maximumDirectTextCharacters: 100 }) }} />);
  await userEvent.type(await screen.findByLabelText("작업 공간 이름"), "보존할 이름");
  await userEvent.click(screen.getByRole("link", { name: "자료 보관함" }));
  expect(screen.getByLabelText("작업 공간 이름")).toHaveValue("보존할 이름");
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole("link", { name: "자료 보관함" }));
  expect(await screen.findByRole("heading", { name: "자료 보관함" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "작업 공간" }));
  await userEvent.click(screen.getByRole("button", { name: "새 작업 공간" }));
  expect(screen.getByLabelText("작업 공간 이름")).toHaveValue("");
  confirm.mockRestore();
});

it("keeps storage recovery available after dismissing the initial load error", async () => {
  const store = new IndexedDbWorkspaceRepository(`load-recovery-${crypto.randomUUID()}`);
  vi.spyOn(store, "load").mockRejectedValueOnce(new Error("저장소 읽기 실패"));
  render(<App router={createTestRouter(["/contexts"])} store={store} services={{ getValidationPolicy: vi.fn().mockResolvedValue({ maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 }, maximumDirectTextCharacters: 100 }) }} />);
  await screen.findByRole("dialog", { name: "요청 오류" });
  await userEvent.click(screen.getByRole("button", { name: "오류 팝업 닫기" }));
  await userEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  expect(await screen.findByRole("heading", { name: "이력서 작업 공간" })).toBeInTheDocument();
});

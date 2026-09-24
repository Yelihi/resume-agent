import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { createTestRouter } from "./test/router";
import { IndexedDbWorkspaceRepository } from "./infrastructure/workspace/IndexedDbWorkspaceRepository";

it("retains a key after failed save, clears it after success, and displays only masked account information", async () => {
  const account = { id: "alice", email: "alice@example.com", mode: "server" as const, hasOpenAiKey: false, maskedOpenAiKey: null, isOperator: false };
  const saveOpenAiKey = vi.fn().mockRejectedValueOnce(new Error("저장 실패")).mockResolvedValue(undefined);
  const getAccount = vi.fn().mockResolvedValueOnce(account).mockResolvedValue({ ...account, hasOpenAiKey: true, maskedOpenAiKey: "sk-…1234" });
  render(<App router={createTestRouter(["/settings"])} store={new IndexedDbWorkspaceRepository(`settings-${crypto.randomUUID()}`)} services={{ getAccount, saveOpenAiKey,
    getValidationPolicy: vi.fn().mockResolvedValue({ maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 }, maximumDirectTextCharacters: 100 }) }} />);
  const input = await screen.findByLabelText("새 API 키");
  const secret = "sk-synthetic-test-key-1234"; // gitleaks:allow — synthetic test input
  await userEvent.type(input, secret);
  await userEvent.click(screen.getByRole("button", { name: "키 저장" }));
  await screen.findByRole("dialog", { name: "요청 오류" });
  expect(input).toHaveValue(secret);
  await userEvent.click(screen.getByRole("button", { name: "오류 팝업 닫기" }));
  await userEvent.click(screen.getByRole("button", { name: "키 저장" }));
  await waitFor(() => expect(input).toHaveValue(""));
  expect(await screen.findByText("등록됨 · sk-…1234")).toBeInTheDocument();
  expect(screen.queryByText(secret)).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "백업 상태" })).not.toBeInTheDocument();
});

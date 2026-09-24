import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { IndexedDbWorkspaceRepository } from "../../infrastructure/workspace/IndexedDbWorkspaceRepository";
import { materialDraft, resumeInput } from "../../test/fixtures";
import { MaterialPicker } from "./MaterialPicker";
import { MaterialEditor } from "./MaterialEditor";

it("imports only explicitly selected unlinked saved materials and drops stale selections", async () => {
  const store = new IndexedDbWorkspaceRepository(`picker-${crypto.randomUUID()}`);
  const contextId = await store.createContext("지원", resumeInput());
  await store.saveMaterial({ ...materialDraft(), title: "이미 연결" }, undefined, contextId);
  const materialId = await store.saveMaterial({ ...materialDraft(), title: "새 자료" });
  const workspace = await store.load();
  const onImport = vi.fn();
  const props = { materials: workspace.materials, versions: workspace.materialVersions, links: workspace.contextMaterials, busy: false, locked: false, onClose: vi.fn(), onImport };
  const { rerender } = render(<MaterialPicker {...props} />);
  expect(screen.getByRole("checkbox", { name: "이미 연결" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "이미 연결" })).toBeChecked();
  expect(screen.getByRole("button", { name: "가져오기" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox", { name: "새 자료" }));
  expect(onImport).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "가져오기" }));
  expect(onImport).toHaveBeenCalledWith([materialId]);
  rerender(<MaterialPicker {...props} busy />);
  expect(screen.getByRole("button", { name: "가져오는 중" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "새 자료" })).toBeDisabled();
  rerender(<MaterialPicker {...props} materials={workspace.materials.filter(material => material.id !== materialId)} />);
  expect(screen.getByRole("button", { name: "가져오기" })).toBeDisabled();
  expect(screen.getByText("0개 선택")).toBeInTheDocument();
});

it("focuses the material title, emits field patches and guards dismissal while busy", () => {
  const updateEditor = vi.fn();
  const onCancel = vi.fn();
  const props = { editor: { ...materialDraft(), input: "", previewed: false }, updateEditor, onCancel, onExtract: vi.fn(), onSave: vi.fn(), busy: false };
  const { rerender } = render(<MaterialEditor {...props} />);
  expect(screen.getByRole("textbox", { name: "자료 제목" })).toHaveFocus();
  fireEvent.change(screen.getByRole("textbox", { name: "자료 제목" }), { target: { value: "수정 제목" } });
  expect(updateEditor).toHaveBeenCalledWith({ title: "수정 제목" });
  expect(screen.getByRole("button", { name: "추출 내용 확인" })).toBeDisabled();
  rerender(<MaterialEditor {...props} busy />);
  fireEvent(screen.getByRole("dialog", { name: "자료 미리보기" }), new Event("cancel", { cancelable: true }));
  expect(onCancel).not.toHaveBeenCalled();
});

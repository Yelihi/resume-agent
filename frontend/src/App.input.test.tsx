import { createTestRouter } from "./test/router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { IndexedDbWorkspaceRepository } from "./infrastructure/workspace/IndexedDbWorkspaceRepository";
import { resumeInput } from "./test/fixtures";

const policy = { maximumFileSizeBytes: { pdf: 20, image: 20, docx: 20, txt: 5 }, maximumDirectTextCharacters: 100 };
function setup(path = "/contexts/new", overrides = {}) {
  window.history.replaceState(null, "", path);
  const store = new IndexedDbWorkspaceRepository(`input-${crypto.randomUUID()}`);
  const services = { getValidationPolicy: vi.fn().mockResolvedValue(policy), extractText: vi.fn().mockResolvedValue(resumeInput().document), extractFile: vi.fn().mockResolvedValue({ kind: "flow", document: resumeInput().document }), ...overrides };
  render(<App router={createTestRouter()} store={store} services={services} />); return { store, services };
}
it("creates an isolated context only after extraction succeeds", async () => {
  const { store, services } = setup();
  await userEvent.type(await screen.findByLabelText("작업 공간 이름"), "프런트엔드 지원");
  await userEvent.click(screen.getByRole("tab", { name: "직접 입력" }));
  await userEvent.type(screen.getByLabelText("이력서 텍스트"), "경력 한 줄");
  await userEvent.click(screen.getByRole("button", { name: "작업 공간 만들기" }));
  expect(await screen.findByRole("button", { name: "이력서 검토하기" })).toBeEnabled();
  expect(services.extractText).toHaveBeenCalledWith("경력 한 줄");
  expect((await store.load()).contexts).toHaveLength(1);
});
it("rejects an oversized file before extraction", async () => {
  const { store, services } = setup();
  await userEvent.type(await screen.findByLabelText("작업 공간 이름"), "A");
  await userEvent.upload(screen.getByLabelText("이력서 파일"), new File(["123456"], "resume.txt", { type: "text/plain" }));
  await userEvent.click(screen.getByRole("button", { name: "작업 공간 만들기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("파일 크기");
  expect(services.extractFile).not.toHaveBeenCalled();
  expect((await store.load()).contexts).toEqual([]);
});

it("requires extraction confirmation before saving a suspect resume", async () => {
  const document = { ...resumeInput("확인할 문장").document, extraction: { status: "needs_review", confirmed: false, issues: [
    { stage: "assessment", code: "LOW_OCR_CONFIDENCE", message: "원본과 비교해 주세요.", lineIds: ["f-l1"], recovered: false },
  ] } };
  const { store } = setup("/contexts/new", { extractText: vi.fn().mockResolvedValue(document) });
  await userEvent.type(await screen.findByLabelText("작업 공간 이름"), "확인 테스트");
  await userEvent.click(screen.getByRole("tab", { name: "직접 입력" }));
  await userEvent.type(screen.getByLabelText("이력서 텍스트"), "확인할 문장");
  await userEvent.click(screen.getByRole("button", { name: "작업 공간 만들기" }));
  expect(await screen.findByRole("dialog", { name: "추출 내용 확인" })).toHaveAttribute("open");
  expect(screen.getByRole("button", { name: "확인 후 저장" })).toBeDisabled();
  expect((await store.load()).contexts).toHaveLength(0);
  await userEvent.click(screen.getByRole("checkbox", { name: "원본과 비교해 검토에 사용할 수 있음을 확인했습니다." }));
  await userEvent.click(screen.getByRole("button", { name: "확인 후 저장" }));
  await screen.findByRole("button", { name: "이력서 검토하기" });
  expect((await store.load()).resumeVersions[0].document?.extraction?.confirmed).toBe(true);
});
it("selects a dropped resume and saves it through the existing extraction flow", async () => {
  const { services } = setup();
  await userEvent.type(await screen.findByLabelText("작업 공간 이름"), "드롭 테스트");
  const input = screen.getByLabelText("이력서 파일");
  const area = input.closest("label")!;
  const file = new File(["hello"], "resume.txt", { type: "text/plain" });
  fireEvent.dragOver(input, { dataTransfer: { files: [file] } });
  expect(area).toHaveClass("is-dragging");
  fireEvent.drop(input, { dataTransfer: { files: [file] } });
  expect(area).not.toHaveClass("is-dragging");
  expect(screen.getByText("resume.txt")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "작업 공간 만들기" }));
  await screen.findByRole("button", { name: "이력서 검토하기" });
  expect(services.extractFile).toHaveBeenCalledWith(file, "txt");
});
it("previews, edits and explicitly saves a material", async () => {
  const { store } = setup("/materials");
  await userEvent.click(await screen.findByRole("button", { name: "새 자료 등록" }));
  expect(screen.getByRole("dialog", { name: "자료 미리보기" })).toHaveAttribute("open");
  expect(screen.getByLabelText("자료 제목")).toHaveFocus();
  await userEvent.type(screen.getByLabelText("자료 제목"), "공고 A");
  await userEvent.type(screen.getByLabelText("자료 입력"), "React 경험");
  await userEvent.click(screen.getByRole("button", { name: "추출 내용 확인" }));
  await screen.findByLabelText("추출 내용");
  expect((await store.load()).materials).toEqual([]);
  await userEvent.type(screen.getByLabelText("추출 내용"), "과 테스트 경험");
  await userEvent.click(screen.getByRole("button", { name: "자료 저장" }));
  await waitFor(async () => expect((await store.load()).materialVersions[0].content).toBe("React 경험과 테스트 경험"));
  expect(screen.queryByRole("dialog", { name: "자료 미리보기" })).not.toBeInTheDocument();
});
it("warns before abandoning an unsaved material draft", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { store } = setup("/materials");
  await userEvent.click(await screen.findByRole("button", { name: "새 자료 등록" }));
  await userEvent.type(screen.getByLabelText("자료 제목"), "작성 중");
  await userEvent.click(screen.getByRole("button", { name: "편집 취소" }));
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByLabelText("자료 제목")).toHaveValue("작성 중");
  expect((await store.load()).materials).toEqual([]);
  fireEvent(screen.getByRole("dialog", { name: "자료 미리보기" }), new Event("cancel", { cancelable: true }));
  expect(screen.getByLabelText("자료 제목")).toHaveValue("작성 중");
  confirm.mockReturnValue(true);
  fireEvent(screen.getByRole("dialog", { name: "자료 미리보기" }), new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog", { name: "자료 미리보기" })).not.toBeInTheDocument();
  confirm.mockRestore();
});

it("keeps a revision and the existing original when extraction fails", async () => {
  const store = new IndexedDbWorkspaceRepository(`revision-${crypto.randomUUID()}`);
  const id = await store.createContext("A", resumeInput());
  window.history.replaceState(null, "", `/contexts/${id}/upload`);
  const services = { getValidationPolicy: vi.fn().mockResolvedValue(policy), extractText: vi.fn().mockRejectedValue(new Error("변환 실패")) };
  render(<App router={createTestRouter()} store={store} services={services} />);
  await userEvent.click(await screen.findByRole("tab", { name: "직접 입력" }));
  await userEvent.type(screen.getByLabelText("이력서 텍스트"), "새 수정본");
  await userEvent.click(screen.getByRole("button", { name: "수정본 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("변환 실패");
  expect(screen.getByLabelText("이력서 텍스트")).toHaveValue("새 수정본");
  const state = await store.load();
  expect(state.resumeVersions).toHaveLength(1);
  expect(state.resumeVersions[0].original).toBe(resumeInput().original);
});

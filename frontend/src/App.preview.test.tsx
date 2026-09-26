import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { createTestRouter } from "./test/router";
import { previewServices, previewStore } from "./infrastructure/preview";
import { IndexedDbWorkspaceRepository } from "./infrastructure/workspace/IndexedDbWorkspaceRepository";
import { materialDraft } from "./test/fixtures";

afterEach(() => vi.unstubAllGlobals());

it("saves and reloads preview text locally, exports that store, and refuses backend work without network calls", async () => {
  const fetch = vi.fn(() => { throw new Error("Preview must not contact a backend"); });
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  const view = render(<App router={createTestRouter(["/contexts/new"])} store={previewStore} services={previewServices} preview />);
  expect(await screen.findByLabelText("미리보기 안내")).toHaveTextContent("이 브라우저에만 저장");
  await user.type(await screen.findByLabelText("작업 공간 이름"), "미리보기 지원");
  await user.click(screen.getByRole("tab", { name: "직접 입력" }));
  await user.type(screen.getByLabelText("이력서 텍스트"), "프런트엔드 개발\nReact 경험");
  await user.click(screen.getByRole("button", { name: "작업 공간 만들기" }));
  await user.click(await screen.findByRole("checkbox", { name: "원본과 비교해 검토에 사용할 수 있음을 확인했습니다." }));
  await user.click(screen.getByRole("button", { name: "확인 후 저장" }));
  await screen.findByRole("heading", { name: "미리보기 지원" });
  await user.click(screen.getByRole("button", { name: "수정본 업로드" }));
  await user.click(await screen.findByRole("tab", { name: "직접 입력" }));
  await user.type(screen.getByLabelText("이력서 텍스트"), "개선한 이력서");
  await user.click(screen.getByRole("button", { name: "수정본 저장" }));
  await user.click(await screen.findByRole("checkbox", { name: "원본과 비교해 검토에 사용할 수 있음을 확인했습니다." }));
  await user.click(screen.getByRole("button", { name: "확인 후 저장" }));
  await screen.findByText("버전 2 · 직접 입력 이력서");
  await user.click(screen.getByRole("button", { name: "이력서 검토하기" }));
  expect(await screen.findByRole("dialog", { name: "요청 오류" })).toHaveTextContent("미리보기에서는");
  view.unmount();

  await previewStore.saveMaterial(materialDraft("텍스트 자료 저장"));
  const reloaded = await new IndexedDbWorkspaceRepository("resume-agent-preview").load();
  expect(reloaded.resumeVersions.at(-1)?.document).toMatchObject({ text: "개선한 이력서" });
  expect(reloaded.materialVersions[0].content).toBe("텍스트 자료 저장");
  expect(reloaded.activeRun).toBeUndefined();
  expect((await new IndexedDbWorkspaceRepository("resume-agent").load()).contexts).toHaveLength(0);
  const archive = await previewServices.exportWorkspace();
  const archiveText = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(archive);
  });
  expect(JSON.parse(archiveText).workspace.contexts[0].name).toBe("미리보기 지원");
  await expect(previewServices.extractFile(new File(["pdf"], "resume.pdf"), "pdf")).rejects.toThrow("미리보기에서는");
  await expect(previewServices.previewMaterial("jobPosting", "https://example.com")).rejects.toThrow("미리보기에서는");
  await expect(previewServices.saveOpenAiKey("synthetic-preview-input")).rejects.toThrow("미리보기에서는");
  render(<App router={createTestRouter(["/settings"])} store={previewStore} services={previewServices} preview />);
  await screen.findByText(/로그인과 API 키 등록이 없는 브라우저 미리보기/);
  expect(screen.queryByLabelText("새 API 키")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

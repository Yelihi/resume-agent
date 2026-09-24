import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App, appRoutes, createAppRouter } from "../App";
import { createMemoryRouter, MemoryRouter } from "react-router";
import { usePageAnnouncement } from "./usePageAnnouncement";
import { IndexedDbWorkspaceRepository } from "../infrastructure/workspace/IndexedDbWorkspaceRepository";
import { createTestRouter } from "../test/router";

const policy = { maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 }, maximumDirectTextCharacters: 100 };
const services = () => ({ getValidationPolicy: vi.fn().mockResolvedValue(policy) });
const repository = () => new IndexedDbWorkspaceRepository(`routing-${crypto.randomUUID()}`);

it("keeps focus inside an open modal when announcing the underlying page", () => {
  function PageWithModal() {
    usePageAnnouncement();
    return <><main id="workspace" tabIndex={-1}><h1>배경 화면</h1></main><dialog open aria-label="확인"><button autoFocus>확인</button></dialog></>;
  }
  render(<MemoryRouter><PageWithModal /></MemoryRouter>);
  expect(document.title).toBe("배경 화면 · Resume Review");
  expect(screen.getByRole("button", { name: "확인" })).toHaveFocus();
});

it("announces the destination page without stealing focus on subsequent input", async () => {
  render(<App router={createTestRouter(["/contexts"])} store={repository()} services={services()} />);
  await screen.findByRole("heading", { name: "이력서 작업 공간" });
  await userEvent.click(screen.getByRole("button", { name: "새 작업 공간" }));
  expect(screen.getByRole("main")).toHaveFocus();
  expect(document.title).toBe("새 작업 공간 · Resume Review");
  await userEvent.type(screen.getByLabelText("작업 공간 이름"), "계속 입력");
  expect(screen.getByLabelText("작업 공간 이름")).toHaveFocus();
});

it("preserves drafts on same-route navigation and protects document unload", async () => {
  const router = createTestRouter(["/contexts/new"]);
  const confirm = vi.fn().mockReturnValue(false);
  render(<App router={router} store={repository()} services={services()} confirm={confirm} />);
  await userEvent.type(await screen.findByLabelText("작업 공간 이름"), "작성 중");
  await act(() => router.navigate("/contexts/new"));
  expect(screen.getByLabelText("작업 공간 이름")).toHaveValue("작성 중");
  expect(confirm).not.toHaveBeenCalled();
  const dirtyUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirtyUnload);
  expect(dirtyUnload.defaultPrevented).toBe(true);
  await userEvent.clear(screen.getByLabelText("작업 공간 이름"));
  const cleanUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
});

it("announces route errors and recovers through the workspace link", async () => {
  const router = createMemoryRouter(appRoutes.map(root => root.index ? root : ({ ...root, children: root.children?.map(route => route.path === "materials" ? { ...route, loader: () => { throw new Error("internal failure details"); } } : route) })), { initialEntries: ["/materials"] });
  const view = render(<App router={router} store={repository()} services={services()} />);
  try {
    await screen.findByRole("heading", { name: "화면을 불러오지 못했습니다" });
    expect(document.title).toBe("화면을 불러오지 못했습니다 · Resume Review");
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.queryByText("internal failure details")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "작업 공간 목록" }));
    await screen.findByRole("heading", { name: "이력서 작업 공간" });
    expect(document.title).toBe("이력서 작업 공간 · Resume Review");
  } finally { view.unmount(); router.dispose(); }
});

it("renders a not-found view for an unknown path and provides a working list link", async () => {
  const router = createTestRouter(["/unknown/nested/path"]);
  render(<App router={router} store={repository()} services={services()} />);
  await screen.findByRole("heading", { name: "페이지를 찾을 수 없습니다" });
  expect(screen.queryByRole("button", { name: "작업 공간 만들기" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "작업 공간 목록" }));
  await screen.findByRole("heading", { name: "이력서 작업 공간" });
  expect(router.state.location.pathname).toBe("/contexts");
});

it.each(["/contexts/missing", "/contexts/missing/upload"])("never creates a workspace from a missing context route: %s", async path => {
  const store = repository();
  const createContext = vi.spyOn(store, "createContext");
  render(<App router={createTestRouter([path])} store={store} services={services()} />);
  await screen.findByRole("heading", { name: "작업 공간을 찾을 수 없습니다" });
  expect(screen.queryByRole("tab", { name: "직접 입력" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /작업 공간 만들기|수정본 저장/ })).not.toBeInTheDocument();
  expect(createContext).not.toHaveBeenCalled();
});

it("redirects the root route to the workspace list with replacement", async () => {
  const router = createTestRouter(["/"]);
  render(<App router={router} store={repository()} services={services()} />);
  await screen.findByRole("heading", { name: "이력서 작업 공간" });
  expect(router.state.location.pathname).toBe("/contexts");
  expect(router.state.historyAction).toBe("REPLACE");
});

it("guards back navigation and clears an abandoned draft before forward navigation", async () => {
  const router = createTestRouter(["/contexts", "/contexts/new"]);
  const confirm = vi.fn().mockReturnValue(false);
  render(<App router={router} store={repository()} services={services()} confirm={confirm} />);
  await userEvent.type(await screen.findByLabelText("작업 공간 이름"), "작성 중");
  await act(() => router.navigate(-1));
  expect(confirm).toHaveBeenCalledWith("저장하지 않은 내용을 버리고 이동할까요?");
  expect(router.state.location.pathname).toBe("/contexts/new");
  expect(screen.getByLabelText("작업 공간 이름")).toHaveValue("작성 중");
  confirm.mockReturnValue(true);
  await act(() => router.navigate(-1));
  await screen.findByRole("heading", { name: "이력서 작업 공간" });
  await act(() => router.navigate(1));
  expect(await screen.findByLabelText("작업 공간 이름")).toHaveValue("");
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("blocks router navigation while extraction is pending even when draft discard is approved", async () => {
  const router = createTestRouter(["/contexts/new"]);
  const confirm = vi.fn().mockReturnValue(true);
  let rejectExtraction!: (reason: Error) => void;
  const extractText = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectExtraction = reject; }));
  render(<App router={router} store={repository()} services={{ ...services(), extractText }} confirm={confirm} />);
  await userEvent.type(await screen.findByLabelText("작업 공간 이름"), "검토");
  await userEvent.click(screen.getByRole("tab", { name: "직접 입력" }));
  await userEvent.type(screen.getByLabelText("이력서 텍스트"), "경력 한 줄");
  await userEvent.click(screen.getByRole("button", { name: "작업 공간 만들기" }));
  await waitFor(() => expect(extractText).toHaveBeenCalled());
  await act(() => router.navigate("/materials"));
  expect(router.state.location.pathname).toBe("/contexts/new");
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => { rejectExtraction(new Error("추출 실패")); });
  await screen.findByRole("alert");
  await act(() => router.navigate("/materials"));
  expect(router.state.location.pathname).toBe("/materials");
  expect(confirm).toHaveBeenCalledOnce();
});

it("uses the production browser router for initial URLs and subsequent route updates", async () => {
  const previousUrl = window.location.href;
  window.history.replaceState(null, "", "/missing-production-page");
  const router = createAppRouter();
  const view = render(<App router={router} store={repository()} services={services()} />);
  try {
    await screen.findByRole("heading", { name: "페이지를 찾을 수 없습니다" });
    await userEvent.click(screen.getByRole("link", { name: "작업 공간 목록" }));
    await screen.findByRole("heading", { name: "이력서 작업 공간" });
    expect(window.location.pathname).toBe("/contexts");
    expect(window.location.hash).toBe("");
    expect(router.state.location.pathname).toBe("/contexts");
  } finally {
    view.unmount();
    router.dispose();
    window.history.replaceState(null, "", previousUrl);
  }
});

it("applies the same draft guard to forward history navigation", async () => {
  const router = createTestRouter(["/contexts/new", "/contexts"]);
  const confirm = vi.fn().mockReturnValue(false);
  render(<App router={router} store={repository()} services={services()} confirm={confirm} />);
  await screen.findByRole("heading", { name: "이력서 작업 공간" });
  await act(() => router.navigate(-1));
  await userEvent.type(await screen.findByLabelText("작업 공간 이름"), "앞으로 이동 전");
  await act(() => router.navigate(1));
  expect(router.state.location.pathname).toBe("/contexts/new");
  expect(screen.getByLabelText("작업 공간 이름")).toHaveValue("앞으로 이동 전");
  confirm.mockReturnValue(true);
  await act(() => router.navigate(1));
  await screen.findByRole("heading", { name: "이력서 작업 공간" });
  expect(confirm).toHaveBeenCalledTimes(2);
});

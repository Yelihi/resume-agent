import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { ResumeAgentStore } from "./storage/store";

const resumeViewerSpy = vi.hoisted(() => vi.fn());
vi.mock("./viewer/ResumeViewer", () => ({
  ResumeViewer: (props: unknown) => {
    resumeViewerSpy(props);
    return null;
  },
}));

const policy = {
  maximumFileSizeBytes: { pdf: 20, image: 20, docx: 20, txt: 5 },
  maximumDirectTextCharacters: 100,
};
const document = {
  text: "경력 한 줄",
  blocks: [
    {
      blockId: "f-b1",
      lines: [{ lineId: "f-l1", text: "경력 한 줄", startOffset: 0, endOffset: 6 }],
    },
  ],
};

function setup(overrides = {}) {
  const store = new ResumeAgentStore(`app-test-${crypto.randomUUID()}`);
  const services = {
    getValidationPolicy: vi.fn().mockResolvedValue(policy),
    extractText: vi.fn().mockResolvedValue(document),
    extractFile: vi.fn().mockResolvedValue({ kind: "flow", document }),
    ...overrides,
  };
  render(<App store={store} services={services} />);
  return { store, services };
}

describe("resume and material inputs", () => {
  it("opens reference materials in a drawer and switches material types", async () => {
    setup();

    const trigger = await screen.findByRole("button", { name: /검토 자료/ });
    expect(screen.queryByRole("dialog", { name: "검토 자료" })).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "검토 자료" })).toBeInTheDocument();
    expect(screen.getByLabelText("채용 공고 입력")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "회사 정보" }));
    expect(screen.getByLabelText("회사 소개 자료 입력")).toBeInTheDocument();
    expect(screen.queryByLabelText("채용 공고 입력")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "검토 자료 닫기" }));
    expect(screen.queryByRole("dialog", { name: "검토 자료" })).not.toBeInTheDocument();
  });

  it("keeps file and direct text resume inputs mutually exclusive", async () => {
    setup();
    await screen.findByText("이력서 원본");

    expect(screen.getByLabelText("이력서 파일")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "직접 입력" }));

    expect(screen.queryByLabelText("이력서 파일")).not.toBeInTheDocument();
    expect(screen.getByLabelText("이력서 텍스트")).toBeInTheDocument();
  });

  it("normalizes direct text and shows a ready resume", async () => {
    const { services } = setup();
    await userEvent.click(await screen.findByRole("tab", { name: "직접 입력" }));
    await userEvent.type(screen.getByLabelText("이력서 텍스트"), "경력 한 줄");
    await userEvent.click(screen.getByRole("button", { name: "이력서 적용" }));

    await screen.findByText(/변환 완료/);
    expect(services.extractText).toHaveBeenCalledWith("경력 한 줄");
  });

  it("rejects an oversized file before extraction", async () => {
    const extractFile = vi.fn();
    setup({ extractFile });
    const input = await screen.findByLabelText("이력서 파일");
    await waitFor(() => expect(input).toBeEnabled());

    await userEvent.upload(input, new File(["123456"], "resume.txt", { type: "text/plain" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("파일 크기");
    expect(extractFile).not.toHaveBeenCalled();
  });

  it("retries the validation policy when a file is selected after startup recovery", async () => {
    const getValidationPolicy = vi
      .fn()
      .mockRejectedValueOnce(new Error("server unavailable"))
      .mockResolvedValue(policy);
    const { services } = setup({ getValidationPolicy });

    await screen.findByRole("dialog", { name: "요청 오류" });
    await userEvent.click(screen.getByRole("button", { name: "오류 팝업 닫기" }));
    const input = screen.getByLabelText("이력서 파일");
    expect(input).toBeEnabled();

    await userEvent.upload(input, new File(["1"], "resume.txt", { type: "text/plain" }));

    await screen.findByText(/변환 완료/);
    expect(getValidationPolicy).toHaveBeenCalledTimes(2);
    expect(services.extractFile).toHaveBeenCalled();
  });

  it("accumulates company URLs and warns without blocking", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /검토 자료/ }));
    await userEvent.click(screen.getByRole("tab", { name: "회사 정보" }));
    const input = await screen.findByLabelText("회사 소개 자료 입력");

    await userEvent.type(input, "https://example.com/about");
    await userEvent.click(screen.getByRole("button", { name: "회사 자료 추가" }));
    await userEvent.type(input, "https://example.com/culture");
    await userEvent.click(screen.getByRole("button", { name: "회사 자료 추가" }));

    expect(screen.getByText("https://example.com/about")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/culture")).toBeInTheDocument();
    expect(screen.getByText(/분석 깊이가 낮아질 수 있습니다/)).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("does not recreate the resume image when a material is added", async () => {
    resumeViewerSpy.mockClear();
    setup();
    const fileInput = await screen.findByLabelText("이력서 파일");
    await waitFor(() => expect(fileInput).toBeEnabled());
    await userEvent.upload(fileInput, new File(["1"], "resume.txt", { type: "text/plain" }));
    await screen.findByText(/변환 완료/);
    await waitFor(() => expect(resumeViewerSpy).toHaveBeenCalled());
    const originalBefore = resumeViewerSpy.mock.calls.at(-1)?.[0].resume.original;

    await userEvent.click(screen.getByRole("button", { name: /검토 자료/ }));
    const input = screen.getByLabelText("채용 공고 입력");
    await userEvent.type(input, "React 개발자 채용");
    await userEvent.click(screen.getByRole("button", { name: "채용 공고 추가" }));

    expect(await screen.findByText("React 개발자 채용")).toBeInTheDocument();
    const originalAfter = resumeViewerSpy.mock.calls.at(-1)?.[0].resume.original;
    expect(originalAfter).toBe(originalBefore);
  });

  it("requires confirmation before deleting a material", async () => {
    const { store } = setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(await screen.findByRole("button", { name: /검토 자료/ }));
    const input = await screen.findByLabelText("채용 공고 입력");
    await userEvent.type(input, "React 경력자를 찾습니다.");
    await userEvent.click(screen.getByRole("button", { name: "채용 공고 추가" }));

    await userEvent.click(screen.getByRole("button", { name: "React 경력자를 찾습니다. 삭제" }));

    expect(confirm).toHaveBeenCalled();
    expect((await store.load()).materials).toHaveLength(1);
    confirm.mockRestore();
  });
});

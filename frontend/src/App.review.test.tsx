import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { MissingOpenAiApiKeyError } from "./api/client";
import { ResumeAgentStore, emptyState } from "./storage/store";

const policy = {
  maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 },
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
const oldReview = { status: "success" as const, errors: [], materialReviews: [], results: [] };
const previousReview = {
  ...oldReview,
  results: [{
    수정포인트위치: { lineIds: ["f-l1"], quote: "경력 한 줄" },
    수정성격: "가독성" as const,
    검토출처: ["기본 검토"] as const,
    "이유 및 제안": "이전 검토 결과입니다.",
    "실제 수정 예시": "이전 수정 예시",
  }],
};

afterEach(() => vi.useRealTimers());

async function readyStore(extra = {}) {
  const store = new ResumeAgentStore(`review-test-${crypto.randomUUID()}`);
  await store.save({
    ...emptyState(),
    activeResume: {
      inputType: "text",
      displayName: "이력서",
      original: "경력 한 줄",
      status: "ready",
      documentKind: "flow",
      document,
    },
    ...extra,
  });
  return store;
}

function baseServices(overrides = {}) {
  return {
    getValidationPolicy: vi.fn().mockResolvedValue(policy),
    startReview: vi.fn().mockResolvedValue("run-1"),
    followReview: vi.fn().mockImplementation(async (_runId, onProgress) => {
      onProgress({ event: "spellCheck", message: "맞춤법 확인 중" });
      onProgress({ event: "completed", message: "완료" });
    }),
    getReviewRecord: vi.fn().mockResolvedValue({ runId: "run-1", createdAt: "2026-09-10T00:00:00Z", document, materials: [], moduleResults: { spellCheck: { moduleKey: "spellCheck", output: [], errors: [] }, finalReview: { moduleKey: "finalReview", output: { materialReviews: [], results: [] }, errors: [] } }, response: oldReview }),
    releaseReview: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("review lifecycle", () => {
  it("shows an actionable shared error popup when review configuration is missing", async () => {
    const store = await readyStore();
    const errors = [{
      moduleKey: "reviewConfiguration",
      inputSourceId: null,
      errorCode: "OPENAI_API_KEY_MISSING",
      userMessage: "OpenAI API 키가 설정되지 않았습니다. 서버 실행 설정을 확인해 주세요.",
      canRetry: false,
    }];
    const services = baseServices({
      startReview: vi.fn().mockRejectedValue(
        new MissingOpenAiApiKeyError(errors[0].userMessage, errors, 503),
      ),
    });
    render(<App store={store} services={services} />);

    await userEvent.click(await screen.findByRole("button", { name: "이력서 검토하기" }));

    const popup = await screen.findByRole("dialog", { name: "요청 오류" });
    expect(popup).toHaveTextContent("OpenAI API 키가 설정되지 않았습니다");
    expect(popup).toHaveTextContent("OPENAI_API_KEY_MISSING");

    await userEvent.click(screen.getByRole("button", { name: "오류 팝업 닫기" }));
    expect(screen.queryByRole("dialog", { name: "요청 오류" })).not.toBeInTheDocument();
  });

  it("locks all inputs while progress is running and exposes cancel", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    const store = await readyStore({ currentReview: previousReview });
    const services = baseServices({
      followReview: vi.fn().mockImplementation(async (_runId, onProgress) => {
        onProgress({ event: "finalReview", message: "수정 제안을 종합하고 있습니다." });
        await pending;
        onProgress({ event: "completed", message: "완료" });
      }),
    });
    render(<App store={store} services={services} />);

    await userEvent.click(await screen.findByRole("button", { name: "이력서 검토하기" }));

    expect(await screen.findByRole("status")).toHaveTextContent("수정 제안을 종합");
    expect(screen.getByLabelText("분석 제안 생성 중")).toBeInTheDocument();
    expect(screen.queryByText("이전 검토 결과입니다.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("이력서 파일")).toBeDisabled();
    expect(screen.getByLabelText("채용 공고 입력")).toBeDisabled();
    expect(screen.getByRole("button", { name: "검토 취소" })).toBeEnabled();
    finish();
    await waitFor(() => expect(screen.queryByRole("button", { name: "검토 취소" })).not.toBeInTheDocument());
  });

  it("cancel preserves the previous result and unlocks input", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    const store = await readyStore({ currentReview: oldReview });
    const cancelReview = vi.fn().mockImplementation(async () => {
      finish();
      return { runId: "run-1", cancelRequested: true };
    });
    const services = baseServices({
      cancelReview,
      followReview: vi.fn().mockImplementation(async (_runId, onProgress) => {
        await pending;
        onProgress({ event: "cancelled", message: "취소" });
      }),
    });
    render(<App store={store} services={services} />);
    await userEvent.click(await screen.findByRole("button", { name: "이력서 검토하기" }));

    await userEvent.click(await screen.findByRole("button", { name: "검토 취소" }));

    await waitFor(() => expect(screen.getByLabelText("채용 공고 입력")).toBeEnabled());
    expect((await store.load()).currentReview).toEqual(oldReview);
    expect(cancelReview).toHaveBeenCalledWith("run-1");
  });

  it("shows a calmer delayed message when one review stage exceeds eight seconds", async () => {
    let finish!: () => void;
    let updateProgress!: (event: { event: string; message: string }) => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    const store = await readyStore();
    const services = baseServices({
      followReview: vi.fn().mockImplementation(async (_runId, onProgress) => {
        updateProgress = onProgress;
        onProgress({ event: "finalReview", message: "수정 제안을 종합하고 있습니다." });
        await pending;
        onProgress({ event: "completed", message: "완료" });
      }),
    });
    render(<App store={store} services={services} />);
    await userEvent.click(await screen.findByRole("button", { name: "이력서 검토하기" }));
    expect(await screen.findByRole("status")).toHaveTextContent("수정 제안을 종합");

    vi.useFakeTimers();
    act(() => updateProgress({ event: "referenceAnalysis", message: "지원 자료를 적용하고 있습니다." }));
    act(() => vi.advanceTimersByTime(8_000));
    expect(screen.getByRole("status")).toHaveTextContent("조금 더 꼼꼼히 확인하고 있습니다");

    vi.useRealTimers();
    finish();
    await waitFor(() => expect(screen.queryByRole("button", { name: "검토 취소" })).not.toBeInTheDocument());
  });

  it("loads saved results even when the server is offline", async () => {
    const store = await readyStore({ reviewRecord: { response: previousReview, runId: "saved-run" } });
    const services = baseServices({ getValidationPolicy: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<App store={store} services={services} />);
    expect(await screen.findByText("이전 검토 결과입니다.")).toBeInTheDocument();
    expect(services.getReviewRecord).not.toHaveBeenCalled();
    expect(services.followReview).not.toHaveBeenCalled();
  });

  it("releases server results only after the record has been committed", async () => {
    const store = await readyStore();
    const releaseReview = vi.fn().mockImplementation(async () => {
      expect((await store.load()).reviewRecord?.runId).toBe("run-1");
      expect((await store.load()).activeRunId).toBeUndefined();
    });
    const services = baseServices({ releaseReview });
    render(<App store={store} services={services} />);
    await userEvent.click(await screen.findByRole("button", { name: "이력서 검토하기" }));
    await waitFor(() => expect(releaseReview).toHaveBeenCalledWith("run-1"));
  });

  it("keeps the server result and run ID when IndexedDB cannot save", async () => {
    const store = await readyStore();
    vi.spyOn(store, "completeReview").mockRejectedValue(new Error("storage full"));
    const services = baseServices();
    render(<App store={store} services={services} />);
    await userEvent.click(await screen.findByRole("button", { name: "이력서 검토하기" }));
    expect(await screen.findByRole("dialog", { name: "요청 오류" })).toHaveTextContent("storage full");
    expect(services.releaseReview).not.toHaveBeenCalled();
    expect((await store.load()).activeRunId).toBe("run-1");
  });

  it("reconnects to a saved run on initialization", async () => {
    const store = await readyStore({ activeRunId: "saved-run" });
    const followReview = vi.fn().mockImplementation(async (_runId, onProgress) => {
      onProgress({ event: "completed", message: "완료" });
    });
    const services = baseServices({ followReview });

    render(<App store={store} services={services} />);

    await waitFor(() => expect(followReview).toHaveBeenCalledWith("saved-run", expect.any(Function)));
  });
});

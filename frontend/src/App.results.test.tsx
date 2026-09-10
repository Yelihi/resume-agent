import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { ResumeAgentStore, emptyState, type ReviewResponse } from "./storage/store";

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
const suggestion: ReviewResponse["results"][number] = {
  수정포인트위치: { lineIds: ["f-l1"], quote: "경력 한 줄" },
  수정성격: "근거" as const,
  검토출처: ["기본 검토", "채용 공고"],
  검토자료근거: [{ sourceId: "job-1", consideredPoint: "React 경험을 요구합니다." }],
  "이유 및 제안": "측정 근거가 필요합니다.",
  "실제 수정 예시": "[확인 필요: 측정 근거]를 추가하세요.",
};
const { 검토출처: _legacySource, ...legacySuggestion } = suggestion;
const review = {
  status: "partial" as const,
  results: [suggestion],
  materialReviews: [
    {
      sourceId: "job-1",
      materialType: "jobPosting" as const,
      status: "applied" as const,
      reason: "React 경험 요구사항을 제안 1에 반영했습니다.",
    },
    {
      sourceId: "company-1",
      materialType: "company" as const,
      status: "notApplied" as const,
      reason: "이력서 원문과 직접 연결할 근거가 부족합니다.",
    },
  ],
  errors: [
    {
      moduleKey: "companyContextAnalysis",
      inputSourceId: null,
      errorCode: "TEMPORARY",
      userMessage: "회사 자료를 확인하지 못했습니다.",
      canRetry: true,
    },
    {
      moduleKey: "requestValidation",
      inputSourceId: null,
      errorCode: "INVALID",
      userMessage: "다시 실행할 수 없습니다.",
      canRetry: false,
    },
  ],
};

async function setup() {
  const store = new ResumeAgentStore(`result-test-${crypto.randomUUID()}`);
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
    currentReview: review,
    lastReview: { results: [legacySuggestion as ReviewResponse["results"][number]] },
    reviewRecord: { runId: "run-1", createdAt: "2026-09-10T00:00:00Z", document, materials: [], moduleResults: { spellCheck: { moduleKey: "spellCheck", output: [], errors: [] }, finalReview: { moduleKey: "finalReview", output: { materialReviews: [], results: [] }, errors: [] } }, response: review },
  });
  const services = {
    getValidationPolicy: vi.fn().mockResolvedValue(policy),
    startReview: vi.fn().mockResolvedValue("run-2"),
    followReview: vi.fn().mockImplementation(async (_runId, onProgress) => {
      onProgress({ event: "completed", message: "완료" });
    }),
    getReviewRecord: vi.fn().mockResolvedValue({ runId: "run-1", createdAt: "2026-09-10T00:00:00Z", document, materials: [], moduleResults: { spellCheck: { moduleKey: "spellCheck", output: [], errors: [] }, finalReview: { moduleKey: "finalReview", output: { materialReviews: [], results: [] }, errors: [] } }, response: review }),
    releaseReview: vi.fn().mockResolvedValue(undefined),
    retryReview: vi.fn().mockResolvedValue({ runId: "run-1" }),
  };
  render(<App store={store} services={services} />);
  await screen.findByText("측정 근거가 필요합니다.");
  return { store, services };
}

describe("review results", () => {
  it("shows the four suggestion fields, highlights the source, and scrolls it into view", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    await setup();

    const workspace = screen.getByRole("region", { name: "이력서 검토 작업 영역" });
    const results = screen.getByRole("region", { name: "분석 결과" });
    expect(workspace).toContainElement(results);
    expect(results).toHaveClass("results-panel");
    expect(screen.getByRole("button", { name: /검토 자료/ })).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(screen.getByRole("button", { name: /경력 한 줄/ }));

    expect(screen.getByText("근거")).toBeInTheDocument();
    const reviewSources = screen.getByLabelText("검토 출처");
    expect(within(reviewSources).getByText("기본 검토")).toBeInTheDocument();
    expect(within(reviewSources).getByText("채용 공고")).toBeInTheDocument();
    expect(screen.getByText("기존 문장")).toBeInTheDocument();
    expect(screen.getByText("수정 제안")).toBeInTheDocument();
    expect(screen.getByText("수정 원인 및 방향")).toBeInTheDocument();
    expect(screen.getByText("공고에서 고려한 점")).toBeInTheDocument();
    expect(screen.getByText("React 경험을 요구합니다.")).toBeInTheDocument();
    expect(screen.getByText("경력 한 줄", { selector: "del" })).toBeInTheDocument();
    expect(screen.getByText("[확인 필요: 측정 근거]를 추가하세요.")).toHaveClass("suggestion-rewrite");
    expect(screen.getByText("경력 한 줄", { selector: "span[data-line-id]" })).toHaveAttribute(
      "data-selected",
      "true",
    );
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center", inline: "nearest" }),
    );
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it("summarizes applied and unapplied reference materials with a reason", async () => {
    await setup();

    expect(screen.getByText("채용 공고 분석 완료 · 반영 1건")).toBeInTheDocument();
    expect(screen.getByText("회사 자료 분석 완료 · 반영 0건")).toBeInTheDocument();
    expect(screen.getByText("이력서 원문과 직접 연결할 근거가 부족합니다.")).toBeInTheDocument();
  });

  it("opens reference materials over the workspace without changing its layout class", async () => {
    await setup();

    await userEvent.click(screen.getByRole("button", { name: /검토 자료/ }));

    expect(screen.getByRole("dialog", { name: "검토 자료" })).toBeVisible();
    expect(screen.getByLabelText("주 메뉴").parentElement).not.toHaveClass("is-drawer-open");
  });

  it("shows retry only for retryable module errors", async () => {
    const { services } = await setup();

    expect(screen.getAllByRole("button", { name: "모듈 다시 실행" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "모듈 다시 실행" }));

    await waitFor(() =>
      expect(services.retryReview).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", response: review }), "companyContextAnalysis"),
    );
  });

  it("stores user feedback and sends it with the next review", async () => {
    const { store, services } = await setup();
    await userEvent.type(screen.getByLabelText("다음 검토에 반영할 의견"), "이미 반영한 제안입니다.");
    await userEvent.click(screen.getByRole("button", { name: "의견 저장" }));
    await waitFor(async () =>
      expect((await store.load()).lastReview?.userFeedback).toBe("이미 반영한 제안입니다."),
    );
    await userEvent.click(screen.getByRole("button", { name: "이력서 검토하기" }));

    await waitFor(() => expect(services.startReview).toHaveBeenCalled());
    expect(services.startReview.mock.calls[0][3]).toMatchObject({
      userFeedback: "이미 반영한 제안입니다.",
      results: [{ 검토출처: ["기본 검토"] }],
    });
  });

  it("explains that saved feedback is applied to the next review", async () => {
    await setup();

    expect(screen.getByText("다음 검토에 반영할 의견")).toBeInTheDocument();
    expect(screen.getByText(/현재 결과는 바뀌지 않으며/)).toBeInTheDocument();
  });
});

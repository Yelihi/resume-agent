import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { App } from "./App";
import { ResumeAgentStore } from "./storage/store";

it("runs the text resume through extraction, review, and location-linked result", async () => {
  const store = new ResumeAgentStore(`integration-${crypto.randomUUID()}`);
  const document = {
    text: "캐시를 적용했습니다.",
    blocks: [
      {
        blockId: "f-b1",
        lines: [{ lineId: "f-l1", text: "캐시를 적용했습니다.", startOffset: 0, endOffset: 11 }],
      },
    ],
  };
  const result = {
    status: "success" as const,
    errors: [],
    materialReviews: [],
    results: [
      {
        수정포인트위치: { lineIds: ["f-l1"], quote: "캐시를 적용했습니다." },
        수정성격: "근거" as const,
        검토출처: ["기본 검토"] as const,
        "이유 및 제안": "어떤 문제를 해결했는지 설명하세요.",
        "실제 수정 예시": "반복 요청을 캐시해 네트워크 요청을 줄였습니다.",
      },
    ],
  };
  const services = {
    getValidationPolicy: vi.fn().mockResolvedValue({
      maximumFileSizeBytes: { pdf: 100, image: 100, docx: 100, txt: 100 },
      maximumDirectTextCharacters: 100,
    }),
    extractText: vi.fn().mockResolvedValue(document),
    startReview: vi.fn().mockResolvedValue("run-1"),
    followReview: vi.fn().mockImplementation(async (_runId, onProgress) => {
      onProgress({ event: "completed", message: "완료" });
    }),
    getReviewRecord: vi.fn().mockResolvedValue({ runId: "run-1", createdAt: "2026-09-10T00:00:00Z", document, materials: [], moduleResults: { spellCheck: { moduleKey: "spellCheck", output: [], errors: [] }, finalReview: { moduleKey: "finalReview", output: { materialReviews: [], results: [] }, errors: [] } }, response: result }),
    releaseReview: vi.fn().mockResolvedValue(undefined),
  };
  render(<App store={store} services={services} />);

  await userEvent.click(await screen.findByRole("tab", { name: "직접 입력" }));
  await userEvent.type(screen.getByLabelText("이력서 텍스트"), "캐시를 적용했습니다.");
  await userEvent.click(screen.getByRole("button", { name: "이력서 적용" }));
  const reviewButton = await screen.findByRole("button", { name: "이력서 검토하기" });
  await waitFor(() => expect(reviewButton).toBeEnabled());
  await userEvent.click(reviewButton);
  await userEvent.click(await screen.findByRole("button", { name: /캐시를 적용했습니다/ }));

  expect(screen.getByText("어떤 문제를 해결했는지 설명하세요.")).toBeInTheDocument();
  expect(screen.getByText("캐시를 적용했습니다.", { selector: "span[data-line-id]" })).toHaveAttribute(
    "data-selected",
    "true",
  );
});

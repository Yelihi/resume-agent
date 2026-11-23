import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { it, expect, vi } from "vitest";
import { PortfolioReviewScreen } from "./PortfolioReview";
import { IndexedDbWorkspaceRepository } from "../../infrastructure/workspace/IndexedDbWorkspaceRepository";
import { resumeInput } from "../../test/fixtures";
import type { PortfolioReview } from "../../domain/review/portfolio";

vi.mock("../../viewer/ResumeViewer", () => ({ PdfViewer: () => <div>PDF</div> }));

it("switches page and document history without showing another version's findings", async () => {
  const databaseName = `portfolio-navigation-${crypto.randomUUID()}`;
  const store = new IndexedDbWorkspaceRepository(databaseName);
  const contextId = await store.createContext("지원", resumeInput("검색 API 운영"));
  const createdAt = "2026-11-23T00:00:00Z";
  await store.savePortfolioVersion({
    id: "recent", name: "recent.pdf", contextId, createdAt,
    original: new Blob(["recent"]), pageCount: 2,
  });
  await store.savePortfolioVersion({
    id: "previous", name: "previous.pdf", contextId, createdAt: "2026-11-22T00:00:00Z",
    original: new Blob(["previous"]), pageCount: 1,
  });
  const result: PortfolioReview = {
    id: "page-one", contextId, portfolioVersionId: "recent", createdAt, pageNumber: 1,
    policyVersion: "portfolio-1", text: "검색 API 운영", textStatus: "complete", imageStatus: "failed",
    comparisonStatus: "complete", conflicts: [], findings: [{
      basis: "text", category: "message", quote: "검색 API 운영", bbox: null,
      diagnosis: "어떤 API인지 구체적으로 드러나지 않습니다.", proposedChange: "제목에 역할을 적으세요.",
      replacementText: "검색 결과를 제공하는 API를 운영했습니다.",
    }],
  };
  await store.savePortfolioReview(result);
  await store.savePortfolioReview({ ...result, id: "page-two", pageNumber: 2, comparisonStatus: "failed",
    findings: [{ basis: "text", category: "message", quote: "검색 API 운영", bbox: null,
      diagnosis: "제목이 모호합니다.", proposedChange: "역할을 확인하세요." }] });
  const reopened = new IndexedDbWorkspaceRepository(databaseName);
  const workspace = await reopened.load();
  render(<MemoryRouter><PortfolioReviewScreen context={workspace.contexts[0]} workspace={workspace}
    store={reopened} services={{}} /></MemoryRouter>);

  const results = within(screen.getByRole("region", { name: "페이지 평가" }));
  const versions = screen.getByRole("combobox", { name: "문서 버전" });
  const user = userEvent.setup();
  expect(versions).toHaveValue("recent");
  expect(results.getByText("비교한 자료에서 차이를 찾지 못했습니다.")).toBeVisible();
  expect(results.getByText("바로 쓸 개선 문장")).toBeVisible();
  expect(results.getByText("검색 결과를 제공하는 API를 운영했습니다.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "2페이지" }));
  expect(results.getByRole("heading", { name: "2페이지 평가" })).toBeVisible();
  expect(results.getByText("비교를 완료하지 못했습니다.")).toBeVisible();
  expect(results.getByText("역할을 확인하세요.")).toBeVisible();
  expect(results.queryByText("바로 쓸 개선 문장")).not.toBeInTheDocument();
  await user.selectOptions(versions, "previous");
  expect(results.getByRole("heading", { name: "1페이지 평가" })).toBeVisible();
  expect(results.getByText("이 페이지의 평가 기록이 없습니다.")).toBeVisible();
  expect(versions).toHaveFocus();
  await user.selectOptions(versions, "recent");
  expect(results.getByText("비교한 자료에서 차이를 찾지 못했습니다.")).toBeVisible();
});

it("shows two pinned citations and ignores a result returned after cancellation", async () => {
  const store = new IndexedDbWorkspaceRepository(`portfolio-ui-${crypto.randomUUID()}`);
  const contextId = await store.createContext("지원", resumeInput("Search 40%"));
  const createdAt = new Date().toISOString();
  const version = { id: "v", name: "work.pdf", contextId, original: new Blob(["pdf"]), pageCount: 2, createdAt };
  await store.savePortfolioVersion(version);
  const context = store.getSnapshot().contexts[0];
  const result: PortfolioReview = { id: "r", contextId, portfolioVersionId: version.id, pageNumber: 1, createdAt,
    policyVersion: "portfolio-1", text: "Search 20%", textStatus: "complete", imageStatus: "failed", findings: [],
    comparisonStatus: "complete", conflicts: [{ project: "Search", field: "metric",
      left: { kind: "portfolio", id: "v", version: "v", title: "work.pdf", quote: "Search 20%", value: "20%" },
      right: { kind: "resume", id: context.latestVersionId, version: "1", title: "이력서", quote: "Search 40%", value: "40%" } }] };
  await store.savePortfolioReview(result);
  const failed: PortfolioReview = { ...result, id: "failed", createdAt: "2099-01-01T00:00:00Z", textStatus: "failed",
    comparisonStatus: "failed", conflicts: [] };
  await store.savePortfolioReview(failed);
  let finish!: (result: PortfolioReview) => void;
  const reviewPortfolioPage = vi.fn(() => new Promise<PortfolioReview>(resolve => { finish = resolve; }));
  render(<MemoryRouter><PortfolioReviewScreen context={context} workspace={store.getSnapshot()}
    store={store} services={{ reviewPortfolioPage }} /></MemoryRouter>);
  const comparison = screen.getByRole("region", { name: "문서 간 일관성" });
  expect(within(comparison).getByText("Search 20%")).toBeVisible();
  expect(within(comparison).getByText("Search 40%")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "다시 평가" }));
  await userEvent.click(screen.getByRole("button", { name: "취소" }));
  finish({ ...result, id: "late" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument());
  expect((await store.load()).portfolioReviews?.map(r => r.id).sort()).toEqual(["failed", "r"]);
  expect(screen.getByRole("button", { name: "남은 페이지 평가 (1)" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
  expect(screen.queryByText("Search 20%")).not.toBeInTheDocument();
});

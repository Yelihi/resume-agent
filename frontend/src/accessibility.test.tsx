import { MemoryRouter } from "react-router";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { AppShell } from "./layout/AppShell";
import { MaterialLibrary } from "./features/materials/MaterialLibrary";
import { SuggestionCard } from "./features/review/SuggestionCard";
import { FlowTextViewer, PdfPage } from "./viewer/ResumeViewer";
import { resumeInput, suggestion } from "./test/fixtures";
import type { FlowDocument } from "./domain/resume/contracts";
import type { SuggestionEntry } from "./domain/review/entities";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("skips navigation by keyboard without changing the application's route", async () => {
  window.history.replaceState(null, "", "/materials");
  render(<MemoryRouter initialEntries={["/materials"]}><AppShell><main id="workspace" tabIndex={-1}><h1>자료 보관함</h1></main></AppShell></MemoryRouter>);
  expect(within(screen.getByRole("navigation", { name: "주 메뉴" })).getByRole("link", { name: "자료 보관함" })).toHaveAttribute("aria-current", "page");
  await userEvent.tab();
  expect(screen.getByRole("link", { name: "본문 바로가기" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("main")).toHaveFocus();
  expect(window.location.pathname).toBe("/materials");
  expect(window.location.hash).toBe("");
});

it("lets keyboard users enter an empty library tab panel", async () => {
  render(<MaterialLibrary materials={[]} versions={[]} busy={false} onCreate={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
  await userEvent.click(screen.getByRole("tab", { name: "전체" }));
  await userEvent.keyboard("{ArrowRight}");
  const tab = screen.getByRole("tab", { name: "회사 자료" });
  const panel = screen.getByRole("tabpanel", { name: "회사 자료" });
  expect(tab).toHaveAttribute("aria-controls", panel.id);
  await userEvent.tab();
  expect(panel).toHaveFocus();
});

it("exposes suggestion headings and named feedback groups", () => {
  const item: SuggestionEntry = { id: "suggestion", contextId: "context", reviewId: "review", resumeVersionId: "version", content: suggestion(), rating: null, decision: "open" };
  render(<SuggestionCard item={item} number={1} locked={false} viewedResumeVersionId="version" onSuggestionChange={vi.fn()} onSelectQuote={vi.fn()} />);
  expect(screen.getByRole("heading", { level: 3, name: "근거" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "검토 출처" })).toHaveTextContent("기본 검토");
  expect(within(screen.getByRole("group", { name: "제안 1 평가" })).getAllByRole("button")).toHaveLength(2);
});

it("exposes the PDF canvas with its page name", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  const renderPage = vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
  const pdf = { getPage: vi.fn().mockResolvedValue({ getViewport: () => ({ width: 100, height: 200 }), render: renderPage }) } as unknown as PDFDocumentProxy;
  const bbox = { x: 0, y: 0, width: 1, height: 1 };
  render(<PdfPage pdf={pdf} selectedLineIds={[]} page={{ pageNumber: 1, blocks: [{ blockId: "block", bbox, lines: [{ lineId: "line", text: "접근 가능한 이력서 본문", bbox, textSource: "embedded", uncertainWords: [] }] }] }} />);
  await waitFor(() => expect(renderPage).toHaveBeenCalledOnce());
  expect(screen.getByRole("img", { name: "1페이지 원본" })).toBeInTheDocument();
});

it("respects reduced motion when scrolling to a quote", () => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  const document = resumeInput().document as FlowDocument;
  const { container, rerender } = render(<FlowTextViewer document={document} selectedLineIds={[]} />);
  const line = container.querySelector<HTMLElement>("[data-line-id]")!;
  line.scrollIntoView = vi.fn();
  rerender(<FlowTextViewer document={document} selectedLineIds={["f-l1"]} />);
  expect(line.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
});

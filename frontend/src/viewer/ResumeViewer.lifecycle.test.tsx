import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ResumeViewer } from "./ResumeViewer";
import type { ActiveResume } from "../domain/resume/entities";
import { resumeInput } from "../test/fixtures";

const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: "" } }));
vi.mock("pdfjs-dist", () => pdfjs);

it("scrolls the selected line inside its own viewer", () => {
  const resume: ActiveResume = { ...resumeInput(), status: "ready" };
  const scroll = vi.fn();
  const { rerender, container } = render(<><span data-line-id="f-l1">다른 화면</span><ResumeViewer resume={resume} selectedLineIds={[]} /></>);
  const line = container.querySelector('.flow-viewer [data-line-id]') as HTMLElement;
  line.scrollIntoView = scroll;
  rerender(<><span data-line-id="f-l1">다른 화면</span><ResumeViewer resume={resume} selectedLineIds={["f-l1"]} selectedSuggestionNumber={1} /></>);
  expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center", inline: "nearest" });
});

function pdfResume(): ActiveResume {
  const file = new Blob(["pdf"]);
  Object.defineProperty(file, "arrayBuffer", { value: vi.fn().mockResolvedValue(new ArrayBuffer(3)) });
  return { inputType: "file", displayName: "resume.pdf", original: file, status: "ready", documentKind: "page", document: { pages: [] } };
}

it("destroys pending PDF loading on unmount and ignores late results", async () => {
  let finish!: (value: unknown) => void;
  const destroy = vi.fn().mockResolvedValue(undefined);
  pdfjs.getDocument.mockReturnValue({ promise: new Promise(resolve => { finish = resolve; }), destroy });
  const { unmount } = render(<ResumeViewer resume={pdfResume()} selectedLineIds={[]} />);
  await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalled());
  unmount();
  expect(destroy).toHaveBeenCalledOnce();
  await act(async () => { finish({ getPage: vi.fn() }); });
});

it("shows PDF loading failures instead of leaving an endless loading message", async () => {
  pdfjs.getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error("Invalid PDF")), destroy: vi.fn().mockResolvedValue(undefined) }));
  render(<ResumeViewer resume={pdfResume()} selectedLineIds={[]} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("PDF 미리보기를 불러오지 못했습니다.");
});

it("replaces the document skeleton when PDF loading completes", async () => {
  let finish!: (value: unknown) => void;
  pdfjs.getDocument.mockReturnValue({ promise: new Promise(resolve => { finish = resolve; }), destroy: vi.fn().mockResolvedValue(undefined) });
  render(<ResumeViewer resume={pdfResume()} selectedLineIds={[]} />);
  const loading = screen.getByRole("status", { name: "문서 미리보기를 준비하고 있습니다" });
  expect(loading.querySelector(".document-skeleton")).toHaveAttribute("aria-hidden", "true");
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => { finish({ getPage: vi.fn() }); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("surfaces an individual page rendering failure without an unhandled rejection", async () => {
  const { PdfPage } = await import("./ResumeViewer");
  const logError = vi.spyOn(console, "error").mockImplementation(() => {});
  const pdf = { getPage: vi.fn().mockRejectedValue(new Error("Page unavailable")) } as unknown as import("pdfjs-dist").PDFDocumentProxy;
  render(<PdfPage pdf={pdf} page={{ pageNumber: 2, blocks: [] }} selectedLineIds={[]} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("2페이지 미리보기를 표시하지 못했습니다.");
  logError.mockRestore();
});

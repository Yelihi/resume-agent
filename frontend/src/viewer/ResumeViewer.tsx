import { useEffect, useRef, useState, type CSSProperties } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import type { NormalizedBBox as BBox, DocumentPage } from "../domain/resume/contracts";
import type { ActiveResume } from "../domain/resume/entities";
import type { FlowDocument, PageDocument } from "../domain/resume/contracts";
import { DocumentSkeleton } from "./DocumentSkeleton";


export function overlayStyle(bbox: BBox): CSSProperties {
  return {
    left: `${bbox.x * 100}%`,
    top: `${bbox.y * 100}%`,
    width: `${bbox.width * 100}%`,
    height: `${bbox.height * 100}%`,
  };
}

function useQuoteScroll(selectedLineIds: string[]) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selectedLine = Array.from(container.current?.querySelectorAll<HTMLElement>("[data-line-id]") ?? [])
      .find(line => line.dataset.lineId === selectedLineIds[0]);
    selectedLine?.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center", inline: "nearest" });
  }, [selectedLineIds]);
  return container;
}

export function FlowTextViewer({
  document,
  selectedLineIds,
  selectedSuggestionNumber,
}: {
  document: FlowDocument;
  selectedLineIds: string[];
  selectedSuggestionNumber?: number;
}) {
  const container = useQuoteScroll(selectedLineIds);
  const selected = new Set(selectedLineIds);
  const markerLineId = selectedLineIds[0];
  return (
    <div ref={container} className="flow-viewer" role="region" aria-label="이력서 원문">
      {document.blocks.map((block) => (
        <div key={block.blockId} className="flow-block">
          {block.lines.map((line) => (
            <span
              key={line.lineId}
              data-line-id={line.lineId}
              data-selected={selected.has(line.lineId) || undefined}
              data-suggestion-number={
                line.lineId === markerLineId ? selectedSuggestionNumber : undefined
              }
            >
              {line.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageOverlay({
  page,
  selectedLineIds,
  selectedSuggestionNumber,
}: {
  page: DocumentPage;
  selectedLineIds: string[];
  selectedSuggestionNumber?: number;
}) {
  const container = useQuoteScroll(selectedLineIds);
  const selected = new Set(selectedLineIds);
  const selectedLines = page.blocks.flatMap((block) =>
    block.lines.filter((line) => selected.has(line.lineId)),
  );
  return (
    <div ref={container} className="page-overlay" aria-hidden="true">
      {selectedLines.map((line, index) => (
        <span
          key={line.lineId}
          data-line-id={line.lineId}
          data-suggestion-number={index === 0 ? selectedSuggestionNumber : undefined}
          style={overlayStyle(line.bbox)}
        />
      ))}
    </div>
  );
}

export function ResumeViewer({
  resume,
  selectedLineIds,
  selectedSuggestionNumber,
}: {
  resume: ActiveResume;
  selectedLineIds: string[];
  selectedSuggestionNumber?: number;
}) {
  const container = useQuoteScroll(selectedLineIds);
  if (!resume.document || !resume.documentKind) return null;
  if (resume.documentKind === "flow") {
    return (
      <FlowTextViewer
        document={resume.document as FlowDocument}
        selectedLineIds={selectedLineIds}
        selectedSuggestionNumber={selectedSuggestionNumber}
      />
    );
  }
  const document = resume.document as PageDocument;
  const original = resume.original;
  if (!original || typeof original === "string") return <div ref={container} className="flow-viewer">
    <p className="notice">이전 버전은 추출 내용만 보관합니다. 원래 페이지 모습은 표시하지 않습니다.</p>
    {document.pages.map(page => <section key={page.pageNumber}><h3>{page.pageNumber}페이지</h3>{page.blocks.flatMap(block => block.lines.map(line => <p key={line.lineId} data-line-id={line.lineId} data-selected={selectedLineIds.includes(line.lineId) || undefined}>{line.text}</p>))}</section>)}
  </div>;
  return resume.displayName.toLowerCase().endsWith(".pdf") ? (
    <PdfViewer
      file={original instanceof Blob ? original : original.downloadUrl}
      document={document}
      selectedLineIds={selectedLineIds}
      selectedSuggestionNumber={selectedSuggestionNumber}
    />
  ) : (
    <ImageViewer
      file={original instanceof Blob ? original : original.downloadUrl}
      document={document}
      selectedLineIds={selectedLineIds}
      selectedSuggestionNumber={selectedSuggestionNumber}
    />
  );
}

function ImageViewer({
  file,
  document,
  selectedLineIds,
  selectedSuggestionNumber,
}: {
  file: Blob | string;
  document: PageDocument;
  selectedLineIds: string[];
  selectedSuggestionNumber?: number;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (typeof file === "string") { setUrl(file); return; }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <div className="page-shell">
      {url && <img src={url} alt="업로드한 이력서" />}
      <PageOverlay
        page={document.pages[0]}
        selectedLineIds={selectedLineIds}
        selectedSuggestionNumber={selectedSuggestionNumber}
      />
    </div>
  );
}

function PdfViewer({
  file,
  document,
  selectedLineIds,
  selectedSuggestionNumber,
}: {
  file: Blob | string;
  document: PageDocument;
  selectedLineIds: string[];
  selectedSuggestionNumber?: number;
}) {
  const [loaded, setLoaded] = useState<{ file: Blob | string; pdf?: PDFDocumentProxy; failed?: boolean }>();
  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const input = typeof file === "string" ? { url: file, withCredentials: true } : { data: await file.arrayBuffer() };
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        loadingTask = pdfjs.getDocument(input);
        const pdf = await loadingTask.promise;
        if (!cancelled) setLoaded({ file, pdf });
      } catch {
        if (!cancelled) setLoaded({ file, failed: true });
      }
    })();
    return () => {
      cancelled = true;
      void loadingTask?.destroy().catch(error => console.warn("PDF cleanup failed", error));
    };
  }, [file]);
  const current = loaded?.file === file ? loaded : undefined;
  if (current?.failed) return <p role="alert">PDF 미리보기를 불러오지 못했습니다. 파일을 다시 확인해 주세요.</p>;
  const pdf = current?.pdf;
  if (!pdf) return <DocumentSkeleton />;
  return (
    <div className="pdf-viewer">
      {document.pages.map((page) => (
        <PdfPage
          key={page.pageNumber}
          pdf={pdf}
          page={page}
          selectedLineIds={selectedLineIds}
          selectedSuggestionNumber={selectedSuggestionNumber}
        />
      ))}
    </div>
  );
}

export function PdfPage({
  pdf,
  page,
  selectedLineIds,
  selectedSuggestionNumber,
}: {
  pdf: PDFDocumentProxy;
  page: DocumentPage;
  selectedLineIds: string[];
  selectedSuggestionNumber?: number;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pageWidth, setPageWidth] = useState<number>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!canvas) return;
    setFailed(false);
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page.pageNumber);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        setPageWidth(viewport.width);
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = "100%";
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas context unavailable");
        renderTask = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled) { setFailed(true); console.error("PDF page rendering failed", error); }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [canvas, page.pageNumber, pdf]);
  return (
    <div className="page-shell" style={pageWidth ? { width: `min(100%, ${pageWidth}px)` } : undefined}>
      {failed && <p role="alert">{page.pageNumber}페이지 미리보기를 표시하지 못했습니다.</p>}
      <canvas ref={setCanvas} role="img" aria-label={`${page.pageNumber}페이지 원본`} />
      <PageOverlay
        page={page}
        selectedLineIds={selectedLineIds}
        selectedSuggestionNumber={selectedSuggestionNumber}
      />
    </div>
  );
}

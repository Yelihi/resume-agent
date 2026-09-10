import { useEffect, useState, type CSSProperties } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import type { components } from "../api/schema";
import type { ActiveResume, FlowDocument, PageDocument } from "../storage/store";

type BBox = components["schemas"]["NormalizedBBox"];
type DocumentPage = components["schemas"]["DocumentPage"];

export function overlayStyle(bbox: BBox): CSSProperties {
  return {
    left: `${bbox.x * 100}%`,
    top: `${bbox.y * 100}%`,
    width: `${bbox.width * 100}%`,
    height: `${bbox.height * 100}%`,
  };
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
  const selected = new Set(selectedLineIds);
  const markerLineId = selectedLineIds[0];
  return (
    <div className="flow-viewer" aria-label="이력서 원문">
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
  const selected = new Set(selectedLineIds);
  const selectedLines = page.blocks.flatMap((block) =>
    block.lines.filter((line) => selected.has(line.lineId)),
  );
  return (
    <div className="page-overlay" aria-hidden="true">
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
  if (!(original instanceof Blob)) return null;
  return resume.displayName.toLowerCase().endsWith(".pdf") ? (
    <PdfViewer
      file={original}
      document={document}
      selectedLineIds={selectedLineIds}
      selectedSuggestionNumber={selectedSuggestionNumber}
    />
  ) : (
    <ImageViewer
      file={original}
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
  file: Blob;
  document: PageDocument;
  selectedLineIds: string[];
  selectedSuggestionNumber?: number;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
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
  file: Blob;
  document: PageDocument;
  selectedLineIds: string[];
  selectedSuggestionNumber?: number;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  useEffect(() => {
    let loaded: PDFDocumentProxy | undefined;
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      loaded = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      setPdf(loaded);
    })();
    return () => void loaded?.destroy();
  }, [file]);
  if (!pdf) return <p>PDF를 렌더링하고 있습니다.</p>;
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
  useEffect(() => {
    if (!canvas) return;
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
        if (context) {
          renderTask = pdfPage.render({
            canvas,
            canvasContext: context,
            viewport,
            transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          });
          await renderTask.promise;
        }
      } catch (error) {
        if (!cancelled) console.error("PDF page rendering failed", error);
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [canvas, page.pageNumber, pdf]);
  return (
    <div className="page-shell" style={pageWidth ? { width: `min(100%, ${pageWidth}px)` } : undefined}>
      <canvas ref={setCanvas} />
      <PageOverlay
        page={page}
        selectedLineIds={selectedLineIds}
        selectedSuggestionNumber={selectedSuggestionNumber}
      />
    </div>
  );
}

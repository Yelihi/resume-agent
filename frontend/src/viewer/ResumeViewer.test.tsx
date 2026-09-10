import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { FlowTextViewer, PageOverlay, PdfPage, overlayStyle } from "./ResumeViewer";

const flowDocument = {
  text: "첫 줄\n둘째 줄",
  blocks: [
    {
      blockId: "f-b1",
      lines: [
        { lineId: "f-l1", text: "첫 줄", startOffset: 0, endOffset: 3 },
        { lineId: "f-l2", text: "둘째 줄", startOffset: 4, endOffset: 8 },
      ],
    },
  ],
};

describe("resume location rendering", () => {
  it("highlights only selected FlowDocument line IDs", () => {
    render(
      <FlowTextViewer
        document={flowDocument}
        selectedLineIds={["f-l2"]}
        selectedSuggestionNumber={2}
      />,
    );

    expect(screen.getByText("첫 줄")).not.toHaveAttribute("data-selected", "true");
    expect(screen.getByText("둘째 줄")).toHaveAttribute("data-selected", "true");
    expect(screen.getByText("둘째 줄")).toHaveAttribute("data-suggestion-number", "2");
  });

  it("converts normalized bbox to percentage overlay coordinates", () => {
    expect(overlayStyle({ x: 0.1, y: 0.2, width: 0.5, height: 0.1 })).toEqual({
      left: "10%",
      top: "20%",
      width: "50%",
      height: "10%",
    });
  });

  it("ignores missing page line IDs", () => {
    const page = {
      pageNumber: 1,
      blocks: [
        {
          blockId: "p1-b1",
          bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
          lines: [
            {
              lineId: "p1-l1",
              text: "줄",
              bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
              textSource: "embedded" as const,
              uncertainWords: [],
            },
          ],
        },
      ],
    };

    const { container } = render(<PageOverlay page={page} selectedLineIds={["p1-l99"]} />);

    expect(container.querySelectorAll("[data-line-id]")).toHaveLength(0);
  });

  it("marks only the first selected PDF line with the suggestion number", () => {
    const page = {
      pageNumber: 1,
      blocks: [{
        blockId: "p1-b1",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        lines: ["p1-l1", "p1-l2"].map((lineId, index) => ({
          lineId,
          text: lineId,
          bbox: { x: 0.1, y: 0.1 + index * 0.1, width: 0.5, height: 0.05 },
          textSource: "embedded" as const,
          uncertainWords: [],
        })),
      }],
    };

    const { container } = render(
      <PageOverlay
        page={page}
        selectedLineIds={["p1-l1", "p1-l2"]}
        selectedSuggestionNumber={4}
      />,
    );
    const selected = container.querySelectorAll("[data-line-id]");

    expect(selected[0]).toHaveAttribute("data-suggestion-number", "4");
    expect(selected[1]).not.toHaveAttribute("data-suggestion-number");
  });

  it("cancels an active PDF render when its canvas unmounts", async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as CanvasRenderingContext2D);
    const cancel = vi.fn();
    const renderPage = vi.fn().mockReturnValue({ promise: new Promise(() => undefined), cancel });
    const pdf = {
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 100, height: 200 }),
        render: renderPage,
      }),
    } as unknown as PDFDocumentProxy;
    const page = {
      pageNumber: 1,
      blocks: [],
    };

    const originalPixelRatio = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 3 });
    const view = render(<PdfPage pdf={pdf} page={page} selectedLineIds={[]} />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    const canvas = view.container.querySelector("canvas");
    expect(canvas).toHaveAttribute("width", "200");
    expect(canvas).toHaveAttribute("height", "400");
    expect(canvas).toHaveStyle({ width: "100%" });
    expect(canvas?.parentElement).toHaveStyle({ width: "min(100%, 100px)" });
    expect(renderPage).toHaveBeenCalledWith(expect.objectContaining({
      transform: [2, 0, 0, 2, 0, 0],
    }));
    view.unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: originalPixelRatio });
    getContext.mockRestore();
  });
});

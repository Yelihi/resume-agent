import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

function Mermaid({ code }: { code: string }) {
  const [result, setResult] = useState<{ code: string; url?: string; failed?: boolean }>();
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    void (async () => {
      if (code.length > 30_000 || !/^(flowchart|graph|sequenceDiagram)\b/.test(code.trim()) || /%%\{|\bclick\s/i.test(code)) throw new Error("Unsupported diagram");
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", flowchart: { htmlLabels: false }, suppressErrorRendering: true });
      const { svg } = await mermaid.render(`experience-${crypto.randomUUID()}`, code);
      if (!active) return;
      // Image documents cannot execute diagram scripts or expose the application DOM.
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setResult({ code, url });
    })().catch(() => { if (active) setResult({ code, failed: true }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [code]);
  const current = result?.code === code ? result : undefined;
  return <figure className="experience-diagram">
    {current?.url ? <img src={current.url} alt={code.match(/accTitle:\s*(.+)/)?.[1] ?? "경험의 작업 흐름도"} />
      : <p role="status">{current?.failed ? "도표를 표시하지 못했습니다. 아래 원문을 확인해 주세요." : "도표를 표시하고 있습니다."}</p>}
    <details><summary>도표 원문</summary><pre>{code}</pre></details>
  </figure>;
}

export function MarkdownDocument({ markdown }: { markdown: string }) {
  return <div className="experience-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ src, alt }) => {
      if (typeof src !== "string" || !/^https?:\/\//i.test(src)) return <span>{alt || "이미지 URL을 확인해 주세요."}</span>;
      try {
        const url = new URL(src);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return <span>{alt || "이미지 URL을 확인해 주세요."}</span>;
        return <img src={url.href} alt={alt || "첨부 이미지"} loading="lazy" referrerPolicy="no-referrer" style={{ maxWidth: "100%", height: "auto" }} />;
      } catch { return <span>{alt || "이미지 URL을 확인해 주세요."}</span>; }
    },
    pre: ({ children }) => <div className="markdown-code">{children}</div>,
    code: ({ className, children }) => className === "language-mermaid" ? <Mermaid code={String(children).trim()} /> : <code className={className}>{children}</code>,
    table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
  }}>{markdown}</Markdown></div>;
}

export function summaryMarkdown(markdown: string): string {
  return markdown.match(/^## 이력서용 요약\s*\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m)?.[1].trim() ?? "";
}

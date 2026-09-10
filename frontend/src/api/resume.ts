import { apiFetch } from "./client";
import type { components } from "./schema";

export type FileKind = "pdf" | "image" | "docx" | "txt";
export type ValidationPolicy = components["schemas"]["ResumeValidationPolicy"];
export type PageDocument = components["schemas"]["PageDocument"];
export type FlowDocument = components["schemas"]["FlowDocument"];

const extensions: Record<string, FileKind> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  tif: "image",
  tiff: "image",
  webp: "image",
  docx: "docx",
  txt: "txt",
};

export function classifyFile(file: File): FileKind {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = extensions[extension];
  if (!kind) throw new Error("지원하지 않는 파일 형식입니다.");
  return kind;
}

export function validateFileSize(file: File, kind: FileKind, policy: ValidationPolicy): void {
  if (file.size > policy.maximumFileSizeBytes[kind]) {
    throw new Error("파일 크기가 허용 범위를 초과했습니다.");
  }
}

export function validateTextLength(text: string, policy: ValidationPolicy): void {
  if (!text.trim()) throw new Error("빈 텍스트는 사용할 수 없습니다.");
  if (text.length > policy.maximumDirectTextCharacters) {
    throw new Error("텍스트 길이가 허용 범위를 초과했습니다.");
  }
}

export const getValidationPolicy = () =>
  apiFetch<ValidationPolicy>("/api/resumes/validation-policy");

export async function extractText(text: string): Promise<FlowDocument> {
  const response = await apiFetch<components["schemas"]["ExtractFlowDocumentResponse"]>(
    "/api/resumes/extract/text",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  return response.document;
}

export async function extractFile(
  file: File,
  kind: FileKind,
): Promise<{ kind: "page"; document: PageDocument } | { kind: "flow"; document: FlowDocument }> {
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch<{ document: PageDocument | FlowDocument }>(
    `/api/resumes/extract/${kind}`,
    { method: "POST", body: form },
  );
  return kind === "pdf" || kind === "image"
    ? { kind: "page", document: response.document as PageDocument }
    : { kind: "flow", document: response.document as FlowDocument };
}

export function documentText(document: PageDocument | FlowDocument): string {
  if ("text" in document) return document.text;
  return document.pages
    .flatMap((page) => page.blocks.flatMap((block) => block.lines.map((line) => line.text)))
    .join("\n");
}

import type { FileKind, ValidationPolicy } from "./ports";
import type { PageDocument, FlowDocument } from "./contracts";

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

export function documentText(document: PageDocument | FlowDocument): string {
  if ("text" in document) return document.text;
  return document.pages
    .flatMap((page) => page.blocks.flatMap((block) => block.lines.map((line) => line.text)))
    .join("\n");
}

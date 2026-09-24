import { describe, expect, it } from "vitest";

import { classifyFile, validateFileSize, validateTextLength } from "./policies";

const policy = {
  maximumFileSizeBytes: { pdf: 10, image: 20, docx: 30, txt: 5 },
  maximumDirectTextCharacters: 4,
};

describe("resume input validation", () => {
  it.each([
    ["resume.pdf", "pdf"],
    ["resume.png", "image"],
    ["resume.docx", "docx"],
    ["resume.txt", "txt"],
  ] as const)("classifies %s before selecting a fixed endpoint", (name, kind) => {
    expect(classifyFile(new File(["x"], name))).toBe(kind);
  });

  it("rejects unsupported files locally", () => {
    expect(() => classifyFile(new File(["x"], "resume.hwp"))).toThrow("지원하지 않는");
  });

  it("rejects oversized files before a request", () => {
    const file = new File(["123456"], "resume.txt");
    expect(() => validateFileSize(file, "txt", policy)).toThrow("파일 크기");
  });

  it("uses JavaScript UTF-16 length for direct text policy", () => {
    expect(() => validateTextLength("A😀BC", policy)).toThrow("텍스트 길이");
  });
});

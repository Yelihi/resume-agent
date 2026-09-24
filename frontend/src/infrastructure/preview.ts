import type { FlowDocument } from "../domain/resume/contracts";
import { validateFileSize, validateTextLength } from "../domain/resume/policies";
import type { ApplicationServices } from "../domain/workspace/services";
import { IndexedDbWorkspaceRepository } from "./workspace/IndexedDbWorkspaceRepository";
import { exportWorkspace } from "./workspace/transfer";

export const previewStore = new IndexedDbWorkspaceRepository("resume-agent-preview");
const policy = { maximumDirectTextCharacters: 100_000, maximumFileSizeBytes: { pdf: 25 * 1024 * 1024, image: 25 * 1024 * 1024, docx: 25 * 1024 * 1024, txt: 1024 * 1024 } };
const unavailable = async (): Promise<never> => { throw new Error("미리보기에서는 AI·OCR·URL 가져오기·계정·서버 동기화를 사용할 수 없습니다. 직접 입력 또는 TXT 파일로 테스트해 주세요."); };

async function extractText(text: string): Promise<FlowDocument> {
  validateTextLength(text, policy);
  let offset = 0;
  const lines = text.split("\n").map((line, index) => {
    const startOffset = offset;
    offset += line.length + 1;
    return { lineId: `f-l${index + 1}`, text: line, startOffset, endOffset: startOffset + line.length };
  });
  return { text, blocks: [{ blockId: "f-b1", lines }] };
}

export const previewServices: ApplicationServices = {
  getValidationPolicy: async () => policy,
  extractText,
  extractFile: async (file, kind) => {
    if (kind !== "txt") return unavailable();
    validateFileSize(file, kind, policy);
    return { kind: "flow", document: await extractText(await file.text()) };
  },
  getAccount: async () => ({ id: "preview", email: "", mode: "local", hasOpenAiKey: false, maskedOpenAiKey: null, isOperator: false }),
  exportWorkspace: () => exportWorkspace(previewStore),
  startReview: unavailable, followReview: unavailable, getReviewRecord: unavailable,
  releaseReview: unavailable, cancelReview: unavailable, retryReview: unavailable,
  previewMaterial: unavailable, writeExperience: unavailable, draftExperience: unavailable,
  experienceMetadata: unavailable, saveOpenAiKey: unavailable, deleteOpenAiKey: unavailable,
  getBackupStatus: unavailable, importWorkspace: unavailable,
};

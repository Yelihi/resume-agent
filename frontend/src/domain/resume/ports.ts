import type { PageDocument, FlowDocument, ResumeValidationPolicy } from "./contracts";
export type FileKind = "pdf" | "image" | "docx" | "txt";
export type ValidationPolicy = ResumeValidationPolicy;
export type ExtractedResume = { kind: "page"; document: PageDocument } | { kind: "flow"; document: FlowDocument };
export interface ResumeGateway {
  getValidationPolicy(): Promise<ValidationPolicy>;
  extractText(text: string): Promise<FlowDocument>;
  extractFile(file: File, kind: FileKind): Promise<ExtractedResume>;
}

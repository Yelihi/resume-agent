import type { PageDocument, FlowDocument } from "./contracts";
import type { OriginalFile } from "../shared/files";

export type ResumeDocument = PageDocument | FlowDocument;
export type ActiveResume = { inputType: "file" | "text"; displayName: string; original?: OriginalFile | string;
  status: "extracting" | "ready" | "failed"; documentKind?: "page" | "flow"; document?: ResumeDocument };
export type ResumeInput = Required<Omit<ActiveResume, "status">>;
export type ResumeVersion = ActiveResume & { id: string; contextId: string; version: number; createdAt: string };

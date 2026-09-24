

import type { OriginalFile } from "../shared/files";

export type MaterialDraft = { title: string; materialType: "company" | "jobPosting"; content: string; source: string; original?: OriginalFile };
export type Material = { id: string; materialType: MaterialDraft["materialType"]; currentVersionId: string | null;
  deleted: boolean; draft?: MaterialDraft & { original?: Blob } };
export type MaterialVersion = MaterialDraft & { id: string; materialId: string; version: number; createdAt: string; legacyUrl?: string };
export type ContextMaterial = { id: string; contextId: string; materialId: string };

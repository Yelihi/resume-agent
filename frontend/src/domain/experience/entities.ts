import type { OriginalFile } from "../shared/files";

export type ExperienceSource = {
  id: string; kind: "note" | "link" | "file"; name: string; text: string;
  url?: string; original?: OriginalFile; createdAt: string;
};
export type Experience = {
  id: string; title: string; period: string; sources: ExperienceSource[];
  markdown?: string; metadata?: string;
  revision: number; createdAt: string; updatedAt: string;
};
export type ExperienceInput = { title: string; period: string; sources: ExperienceSource[]; removedSourceIds?: string[]; markdown?: string; metadata?: string };
export type AuthoringInput = { title: string; period: string; markdown: string; sources: Omit<ExperienceSource, "original">[]; useTemplate?: boolean };
export type WritingInput = {
  experience: { id: string; title: string; period: string; revision: number; sources: Omit<ExperienceSource, "original">[]; markdown?: string; metadata?: string };
  resume: { id: string; text: string };
  materials: { id: string; title: string; content: string; materialType: "company" | "jobPosting" }[];
};
export type WritingResult = { markdown: string; summary: string; questions: string[]; sourceNotes: { sourceId: string; text: string; verified: boolean; failureReason?: "content_unavailable" | "source_unverified" | null }[] };
export type ExperienceDocument = WritingResult & {
  id: string; contextId: string; experienceId: string; input: WritingInput;
  revision: number; createdAt: string; updatedAt: string;
};
export interface ExperienceGateway {
  writeExperience(input: WritingInput): Promise<WritingResult>;
  draftExperience(input: AuthoringInput, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<WritingResult>;
  experienceMetadata(input: Pick<AuthoringInput, "title" | "period" | "markdown">, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<{ metadata: string }>;
}

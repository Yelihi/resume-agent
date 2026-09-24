import type { Workspace } from "./entities";
import type { ResumeInput } from "../resume/entities";
import type { MaterialDraft } from "../material/entities";
import type { Rating, Decision, PreparedReview } from "../review/entities";
import type { ReviewRecord } from "../review/contracts";
import type { ExperienceInput, ExperienceDocument } from "../experience/entities";

/** Atomic local workspace persistence and committed snapshot subscriptions. */
export interface WorkspaceRepository {
  getSnapshot(): Workspace;
  getLoaded(): boolean;
  subscribe(listener: () => void): () => void;
  load(): Promise<Workspace>;
  saveExperience(input: ExperienceInput, id?: string, baseRevision?: number): Promise<string>;
  saveExperienceDocument(document: Omit<ExperienceDocument, "revision" | "createdAt" | "updatedAt">, baseRevision?: number): Promise<void>;
  deleteExperienceDocument(id: string): Promise<void>;
  createContext(name: string, input: ResumeInput): Promise<string>;
  addResumeVersion(contextId: string, input: ResumeInput, baseVersionId: string): Promise<void>;
  saveMaterial(draft: MaterialDraft, materialId?: string, contextId?: string, baseVersionId?: string | null): Promise<string>;
  attachMaterial(contextId: string, materialIds: string | string[]): Promise<void>;
  detachMaterial(contextId: string, materialId: string): Promise<void>;
  deleteMaterial(materialId: string): Promise<void>;
  deleteContext(contextId: string): Promise<void>;
  setSuggestionFeedback(contextId: string, id: string, change: { rating?: Rating; decision?: Decision }): Promise<void>;
  saveReviewFeedback(contextId: string, userFeedback: string): Promise<void>;
  setContextExperiences(contextId: string, experienceIds: string[]): Promise<void>;
  prepareReview(contextId: string): Promise<PreparedReview>;
  prepareRetry(reviewId: string): Promise<ReviewRecord>;
  registerRun(runId: string, input: PreparedReview): Promise<void>;
  clearActiveRun(runId: string): Promise<void>;
  completeReview(record: ReviewRecord): Promise<void>;
  restoreRecord(reviewId: string): Promise<ReviewRecord>;
}

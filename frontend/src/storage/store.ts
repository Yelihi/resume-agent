import { openDB } from "idb";

import type { components } from "../api/schema";

export type PageDocument = components["schemas"]["PageDocument"];
export type FlowDocument = components["schemas"]["FlowDocument"];
export type ReviewResponse = components["schemas"]["ReviewResponse"];
export type ReviewRecord = components["schemas"]["ReviewRecord"];
export type PreviousReview = components["schemas"]["PreviousReview"];
export type ResumeDocument = PageDocument | FlowDocument;

export type ActiveResume = {
  inputType: "file" | "text";
  displayName: string;
  original: Blob | string;
  status: "extracting" | "ready" | "failed";
  documentKind?: "page" | "flow";
  document?: ResumeDocument;
};

export type MaterialRecord = {
  sourceId: string;
  materialType: "company" | "jobPosting";
  inputType: "text" | "document" | "url";
  status: "registered" | "extracted" | "failed";
  displayName: string;
  content?: string;
  url?: string;
  original?: Blob;
};

export type AppState = {
  activeResume?: ActiveResume;
  materials: MaterialRecord[];
  currentReview?: ReviewResponse;
  lastReview?: PreviousReview;
  activeRunId?: string;
  reviewRecord?: ReviewRecord;
};

export const emptyState = (): AppState => ({ materials: [] });

export class ResumeAgentStore {
  constructor(private readonly databaseName = "resume-agent") {}

  private database() {
    return openDB(this.databaseName, 1, {
      upgrade(database) {
        database.createObjectStore("state");
      },
    });
  }

  async load(): Promise<AppState> {
    const database = await this.database();
    const state: AppState = (await database.get("state", "app")) ?? emptyState();
    return { ...state, currentReview: state.reviewRecord?.response ?? state.currentReview };
  }

  async save(state: AppState): Promise<void> {
    const database = await this.database();
    await database.put("state", state, "app");
  }

  private async update(change: (state: AppState) => void): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("state", "readwrite");
    const state = (await transaction.store.get("app")) ?? emptyState();
    change(state);
    await transaction.store.put(state, "app");
    await transaction.done;
  }

  async beginResumeReplacement(input: Omit<ActiveResume, "status">): Promise<void> {
    await this.update((state) => {
      state.activeResume = { ...input, status: "extracting" };
      delete state.currentReview;
      delete state.activeRunId;
      delete state.reviewRecord;
    });
  }

  async completeResumeExtraction(
    documentKind: "page" | "flow",
    document: ResumeDocument,
  ): Promise<void> {
    await this.update((state) => {
      if (!state.activeResume) throw new Error("active resume is missing");
      state.activeResume.status = "ready";
      state.activeResume.documentKind = documentKind;
      state.activeResume.document = document;
    });
  }

  async failResumeExtraction(): Promise<void> {
    await this.update((state) => {
      if (state.activeResume) state.activeResume.status = "failed";
    });
  }

  async deleteResume(): Promise<void> {
    await this.update((state) => {
      delete state.activeResume;
      delete state.currentReview;
      delete state.activeRunId;
      delete state.reviewRecord;
    });
  }

  async addMaterial(material: MaterialRecord): Promise<void> {
    await this.update((state) => {
      if (state.materials.some((item) => item.sourceId === material.sourceId)) {
        throw new Error("material source ID already exists");
      }
      state.materials.push(material);
    });
  }

  async completeMaterialExtraction(sourceId: string, content: string): Promise<void> {
    await this.update((state) => {
      const item = state.materials.find((material) => material.sourceId === sourceId);
      if (!item) throw new Error("material is missing");
      item.status = "extracted";
      item.content = content;
      delete item.original;
    });
  }

  async failMaterialExtraction(sourceId: string): Promise<void> {
    await this.update((state) => {
      const item = state.materials.find((material) => material.sourceId === sourceId);
      if (item) item.status = "failed";
    });
  }

  async deleteMaterial(sourceId: string): Promise<void> {
    await this.update((state) => {
      state.materials = state.materials.filter((item) => item.sourceId !== sourceId);
    });
  }

  async setActiveRun(runId: string): Promise<void> {
    await this.update((state) => {
      state.activeRunId = runId;
    });
  }

  async clearActiveRun(): Promise<void> {
    await this.update((state) => {
      delete state.activeRunId;
    });
  }

  async completeReview(record: ReviewRecord): Promise<void> {
    await this.update((state) => {
      const review = record.response;
      state.reviewRecord = record;
      delete state.currentReview;
      delete state.activeRunId;
      if (review.status === "success" || review.status === "partial") {
        state.lastReview = { results: review.results };
      }
    });
  }

  async saveReviewFeedback(userFeedback: string): Promise<void> {
    await this.update((state) => {
      if (!state.lastReview) throw new Error("last review is missing");
      state.lastReview.userFeedback = userFeedback || null;
    });
  }
}

import { emptyWorkspace, type Workspace } from "../../domain/workspace/entities";
import type { WorkspaceRepository } from "../../domain/workspace/ports";
import { apiFetch } from "../http/client";
import { reconcileWorkspace } from "./snapshot";

type Envelope<T = unknown> = { workspace: Workspace; revision: number; result: T };
const uploaded = new WeakMap<Blob, { fileId: string }>();
export type UploadedFile = { blob: Blob; fileId: string };

export async function discardUploads(files: UploadedFile[]) {
  for (const { blob, fileId } of files) {
    uploaded.delete(blob);
    // A lost response may already have committed the file; the server refuses to delete referenced originals.
    await apiFetch(`/api/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }).catch(() => {});
  }
}

export async function encodeFiles(value: unknown, name = "original", files: UploadedFile[] = []): Promise<unknown> {
  if (value instanceof Blob) {
    const cached = uploaded.get(value);
    if (cached) return cached;
    const body = new FormData();
    body.append("file", value, value instanceof File ? value.name : name);
    const reference = await apiFetch<{ fileId: string }>("/api/files", { method: "POST", body });
    uploaded.set(value, reference);
    files.push({ blob: value, fileId: reference.fileId });
    return reference;
  }
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) result.push(await encodeFiles(item, name, files));
    return result;
  }
  if (value && typeof value === "object") {
    if ("fileId" in value) return { fileId: value.fileId };
    const fields = value as Record<string, unknown>;
    const entries = [];
    for (const [key, item] of Object.entries(fields).filter(([, item]) => item !== undefined)) {
      entries.push([key, await encodeFiles(item, String(fields.displayName ?? fields.name ?? fields.source ?? name), files)]);
    }
    return Object.fromEntries(entries);
  }
  return value;
}

export function decodeFiles<T>(value: T): T {
  if (Array.isArray(value)) return value.map(decodeFiles) as T;
  if (value && typeof value === "object") {
    if ("fileId" in value && typeof value.fileId === "string") return {
      fileId: value.fileId, downloadUrl: `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/files/${encodeURIComponent(value.fileId)}`,
    } as T;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeFiles(item)])) as T;
  }
  return value;
}

export class ServerWorkspaceRepository implements WorkspaceRepository {
  private snapshot = emptyWorkspace();
  private revision = -1;
  private readonly listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  getLoaded = () => this.revision >= 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private publish(envelope: Envelope) {
    if (envelope.revision < this.revision) return;
    const first = !this.getLoaded();
    this.revision = envelope.revision;
    const next = reconcileWorkspace(this.snapshot, decodeFiles(envelope.workspace));
    if (!first && next === this.snapshot) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  load = async () => {
    this.publish(await apiFetch<Envelope>("/api/workspace"));
    return this.snapshot;
  };
  private async command<K extends Exclude<keyof WorkspaceRepository, "getSnapshot" | "getLoaded" | "subscribe" | "load">>(
    operation: K, args: Parameters<WorkspaceRepository[K]>,
  ): Promise<Awaited<ReturnType<WorkspaceRepository[K]>>> {
    const payload = operation === "registerRun" ? [args[0]] : operation === "completeReview" ? [(args[0] as { runId: string }).runId] : args;
    const files: UploadedFile[] = [];
    try {
      const envelope = await apiFetch<Envelope<Awaited<ReturnType<WorkspaceRepository[K]>>>>("/api/workspace/commands", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, args: await encodeFiles(payload, "original", files) }),
      });
      this.publish(envelope);
      return decodeFiles(envelope.result);
    } catch (error) { await discardUploads(files); throw error; }
  }
  saveExperience: WorkspaceRepository["saveExperience"] = (...args) => this.command("saveExperience", args);
  saveExperienceDocument: WorkspaceRepository["saveExperienceDocument"] = (...args) => this.command("saveExperienceDocument", args);
  deleteExperienceDocument: WorkspaceRepository["deleteExperienceDocument"] = (...args) => this.command("deleteExperienceDocument", args);
  createContext: WorkspaceRepository["createContext"] = (...args) => this.command("createContext", args);
  addResumeVersion: WorkspaceRepository["addResumeVersion"] = (...args) => this.command("addResumeVersion", args);
  saveMaterial: WorkspaceRepository["saveMaterial"] = (...args) => this.command("saveMaterial", args);
  attachMaterial: WorkspaceRepository["attachMaterial"] = (...args) => this.command("attachMaterial", args);
  detachMaterial: WorkspaceRepository["detachMaterial"] = (...args) => this.command("detachMaterial", args);
  deleteMaterial: WorkspaceRepository["deleteMaterial"] = (...args) => this.command("deleteMaterial", args);
  deleteContext: WorkspaceRepository["deleteContext"] = (...args) => this.command("deleteContext", args);
  setSuggestionFeedback: WorkspaceRepository["setSuggestionFeedback"] = (...args) => this.command("setSuggestionFeedback", args);
  saveReviewFeedback: WorkspaceRepository["saveReviewFeedback"] = (...args) => this.command("saveReviewFeedback", args);
  setContextExperiences: WorkspaceRepository["setContextExperiences"] = (...args) => this.command("setContextExperiences", args);
  prepareReview: WorkspaceRepository["prepareReview"] = (...args) => this.command("prepareReview", args);
  prepareRetry: WorkspaceRepository["prepareRetry"] = (...args) => this.command("prepareRetry", args);
  registerRun: WorkspaceRepository["registerRun"] = (runId, input) => this.command("registerRun", [runId, input]);
  clearActiveRun: WorkspaceRepository["clearActiveRun"] = (...args) => this.command("clearActiveRun", args);
  completeReview: WorkspaceRepository["completeReview"] = record => record.response.status === "cancelled"
    ? this.clearActiveRun(record.runId) : this.command("completeReview", [record]);
  restoreRecord: WorkspaceRepository["restoreRecord"] = (...args) => this.command("restoreRecord", args);
}

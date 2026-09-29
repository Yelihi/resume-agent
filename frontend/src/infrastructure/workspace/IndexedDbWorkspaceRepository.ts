import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";

import { emptyWorkspace, type Workspace, type Context, type ResumeVersion, type Material, type MaterialVersion,
  type ContextMaterial, type Review, type SuggestionEntry, type ReviewMaterial, type PendingRun,
  type Suggestion, type ReviewContext, type ContextRefs, type ResumeInput, type MaterialDraft, type Rating,
  type Decision, type PreparedReview, type ReviewRecord, type ReferenceMaterial } from "../../domain/workspace/index";
import { reconcileWorkspace } from "./snapshot";
import type { WorkspaceRepository } from "../../domain/workspace/ports";
import type { Experience, ExperienceInput, ExperienceDocument } from "../../domain/experience/entities";

interface WorkspaceDB extends DBSchema {
  experiences: { key: string; value: Experience };
  experienceDocuments: { key: string; value: ExperienceDocument; indexes: { contextId: string } };
  contexts: { key: string; value: Context };
  resumeVersions: { key: string; value: ResumeVersion; indexes: { contextId: string } };
  materials: { key: string; value: Material };
  materialVersions: { key: string; value: MaterialVersion; indexes: { materialId: string } };
  contextMaterials: { key: string; value: ContextMaterial; indexes: { contextId: string; materialId: string } };
  reviews: { key: string; value: Review; indexes: { contextId: string } };
  suggestions: { key: string; value: SuggestionEntry; indexes: { contextId: string } };
  reviewMaterials: { key: string; value: ReviewMaterial; indexes: { reviewId: string; materialVersionId: string } };
  meta: { key: string; value: PendingRun };
}
const stores = ["contexts", "resumeVersions", "materials", "materialVersions", "contextMaterials", "reviews", "suggestions", "reviewMaterials", "meta", "experiences", "experienceDocuments"] as const;
type WriteTx = IDBPTransaction<WorkspaceDB, typeof stores, "readwrite">;
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
function requireValue<T>(value: T | undefined | null, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}
const normalizedSuggestion = (item: Suggestion): Suggestion => ({ ...item, id: item.id ?? uuid(),
  previousSuggestionId: item.previousSuggestionId ?? null, 검토출처: item.검토출처 ?? ["기본 검토"], 검토자료근거: item.검토자료근거 ?? [] });
const refs = (input: ReviewContext): ContextRefs => ({ ...input, feedback: (input.feedback ?? []).map(({ suggestion: _content, ...reference }) => reference) });

export class IndexedDbWorkspaceRepository implements WorkspaceRepository {
  private connection?: Promise<IDBPDatabase<WorkspaceDB>>;
  private snapshot = emptyWorkspace();
  private loaded = false;
  private readonly listeners = new Set<() => void>();
  private readSequence = 0;
  private publishedSequence = 0;

  getSnapshot = (): Workspace => this.snapshot;
  getLoaded = (): boolean => this.loaded;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(workspace: Workspace, sequence: number) {
    if (sequence < this.publishedSequence) return;
    this.publishedSequence = sequence;
    const next = reconcileWorkspace(this.snapshot, workspace);
    if (this.loaded && next === this.snapshot) return;
    this.snapshot = next;
    this.loaded = true;
    for (const listener of this.listeners) listener();
  }

  constructor(private readonly databaseName = "resume-agent") {}

  private database() {
    if (!this.connection) this.connection = openDB<WorkspaceDB>(this.databaseName, 3, {
      upgrade: (db, old, _new, transaction) => {
        db.createObjectStore("experiences", { keyPath: "id" });
        db.createObjectStore("experienceDocuments", { keyPath: "id" }).createIndex("contextId", "contextId");
        if (old >= 2) return;
        db.createObjectStore("contexts", { keyPath: "id" });
        for (const name of ["resumeVersions", "reviews", "suggestions"] as const) {
          db.createObjectStore(name, { keyPath: "id" }).createIndex("contextId", "contextId");
        }
        db.createObjectStore("materials", { keyPath: "id" });
        db.createObjectStore("materialVersions", { keyPath: "id" }).createIndex("materialId", "materialId");
        const links = db.createObjectStore("contextMaterials", { keyPath: "id" });
        links.createIndex("contextId", "contextId"); links.createIndex("materialId", "materialId");
        const used = db.createObjectStore("reviewMaterials", { keyPath: "id" });
        used.createIndex("reviewId", "reviewId"); used.createIndex("materialVersionId", "materialVersionId");
        db.createObjectStore("meta");
        // Version 1 held one untyped app record. Migrate in the upgrade transaction, then remove its duplicate blobs.
        const legacyDb = db as unknown as IDBPDatabase;
        if (legacyDb.objectStoreNames.contains("state")) {
          const legacyTx = transaction as unknown as IDBPTransaction<unknown, string[], "versionchange">;
          void legacyTx.objectStore("state").get("app").then(async legacy => {
            await this.migrate(transaction as unknown as WriteTx, legacy);
            legacyDb.deleteObjectStore("state");
          }).catch(() => transaction.abort());
        }
      },
      blocking: () => { void this.connection?.then(db => db.close()); this.connection = undefined; },
      terminated: () => { this.connection = undefined; },
    }).catch(error => { this.connection = undefined; throw error; });
    return this.connection;
  }

  private async write<T>(action: (tx: WriteTx) => Promise<T>): Promise<T> {
    const tx = (await this.database()).transaction(stores, "readwrite");
    const sequence = ++this.readSequence;
    let value: T;
    let workspace: Workspace;
    try {
      value = await action(tx);
      workspace = await this.readWorkspace(tx);
      await tx.done;
    }
    catch (error) { try { tx.abort(); } catch { /* Already aborted. */ } await tx.done.catch(() => {}); throw error; }
    this.publish(workspace, sequence);
    return value;
  }

  load = async (): Promise<Workspace> => {
    const tx = (await this.database()).transaction(stores, "readonly");
    const sequence = ++this.readSequence;
    const workspace = await this.readWorkspace(tx);
    await tx.done;
    this.publish(workspace, sequence);
    return this.snapshot;
  };

  private async readWorkspace(tx: IDBPTransaction<WorkspaceDB, typeof stores, "readonly" | "readwrite">): Promise<Workspace> {
    const [contexts, resumeVersions, materials, materialVersions, contextMaterials, reviews, suggestions, reviewMaterials, activeRun, experiences, experienceDocuments] = await Promise.all([
      tx.objectStore("contexts").getAll(), tx.objectStore("resumeVersions").getAll(), tx.objectStore("materials").getAll(),
      tx.objectStore("materialVersions").getAll(), tx.objectStore("contextMaterials").getAll(), tx.objectStore("reviews").getAll(),
      tx.objectStore("suggestions").getAll(), tx.objectStore("reviewMaterials").getAll(), tx.objectStore("meta").get("activeRun"),
      tx.objectStore("experiences").getAll(), tx.objectStore("experienceDocuments").getAll(),
    ]);
    return { contexts: contexts.sort((a,b) => a.createdAt.localeCompare(b.createdAt)),
      resumeVersions: resumeVersions.sort((a,b) => a.version-b.version), materials, materialVersions, contextMaterials,
      reviews: reviews.sort((a,b) => a.createdAt.localeCompare(b.createdAt)), suggestions, reviewMaterials, activeRun,
      experiences: experiences.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), experienceDocuments };
  }

  async saveExperience(input: ExperienceInput, id?: string, baseRevision?: number): Promise<string> {
    if (input.sources.some(source => !source.text.trim() && !source.url && !source.original)) throw new Error("메모, 링크 또는 파일을 추가해 주세요.");
    if (input.markdown !== undefined && (!input.markdown.trim() || input.markdown.length > 60_000 || !input.metadata?.trim() || input.metadata.length > 12_000)) throw new Error("경험 본문과 메타데이터를 확인해 주세요.");
    return this.write(async tx => {
      const old = id ? requireValue(await tx.objectStore("experiences").get(id), "경험 기록을 찾을 수 없습니다.") : undefined;
      if (old && old.revision !== baseRevision) throw new Error("경험 기록이 변경됐습니다. 최신 기록을 다시 열어 주세요.");
      const removed = input.removedSourceIds ?? [];
      if (new Set(removed).size !== removed.length || removed.some(id => !old?.sources.some(source => source.id === id))) throw new Error("삭제할 원본 자료를 다시 확인해 주세요.");
      const sources = [...(old?.sources ?? []).filter(source => !removed.includes(source.id)), ...input.sources];
      if (!sources.length && !(input.markdown ?? old?.markdown)?.trim()) throw new Error("메모, 링크 또는 파일을 추가해 주세요.");
      if (sources.length > 100) throw new Error("한 경험에는 원본을 100개까지 보관할 수 있습니다.");
      if (new Set(input.sources.map(source => source.id)).size !== input.sources.length || input.sources.some(source => old?.sources.some(saved => saved.id === source.id))) throw new Error("이미 저장한 원본은 다시 추가할 수 없습니다.");
      const experienceId = id ?? uuid(), updatedAt = now();
      await tx.objectStore("experiences").put({ id: experienceId, title: input.title.trim() || old?.title || input.markdown?.split("\n")[0].replace(/^#+\s*/, "").slice(0, 80) || input.sources[0]?.name.slice(0, 80) || "경험",
        period: input.period, markdown: input.markdown ?? old?.markdown, metadata: input.metadata ?? old?.metadata, sources, revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? updatedAt, updatedAt });
      return experienceId;
    });
  }

  async saveExperienceDocument(document: Omit<ExperienceDocument, "revision" | "createdAt" | "updatedAt">, baseRevision?: number): Promise<void> {
    if (!document.markdown.trim()) throw new Error("작성할 내용을 입력해 주세요.");
    await this.write(async tx => {
      requireValue(await tx.objectStore("contexts").get(document.contextId), "작업 공간을 찾을 수 없습니다.");
      const experience = requireValue(await tx.objectStore("experiences").get(document.experienceId), "경험 기록을 찾을 수 없습니다.");
      const resume = await tx.objectStore("resumeVersions").get(document.input.resume.id);
      const old = await tx.objectStore("experienceDocuments").get(document.id);
      if (old && (old.contextId !== document.contextId || old.experienceId !== document.experienceId || old.revision !== baseRevision)) throw new Error("다른 화면에서 작성본을 수정했습니다. 최신 작성본을 다시 열어 주세요.");
      if (!old && baseRevision !== undefined) throw new Error("삭제된 작성본입니다. 다시 작성해 주세요.");
      const historicalSources = old?.input.experience.sources ?? [];
      if (resume?.contextId !== document.contextId || document.input.experience.id !== experience.id ||
          document.input.experience.sources.some(source => !experience.sources.some(original => original.id === source.id) && !historicalSources.some(saved =>
            saved.id === source.id && saved.kind === source.kind && saved.name === source.name && saved.text === source.text && saved.url === source.url && saved.createdAt === source.createdAt))) throw new Error("작성본의 원본 연결을 확인해 주세요.");
      const noteSourceIds = new Set([...experience.sources.map(source => source.id), ...historicalSources.map(source => source.id), ...(old?.sourceNotes ?? []).map(note => note.sourceId)]);
      if (document.sourceNotes.some(note => !noteSourceIds.has(note.sourceId))) throw new Error("작성본의 출처를 확인해 주세요.");
      const updatedAt = now();
      await tx.objectStore("experienceDocuments").put({ ...document, revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? updatedAt, updatedAt });
    });
  }

  async deleteExperienceDocument(id: string): Promise<void> {
    await this.write(async tx => { await tx.objectStore("experienceDocuments").delete(id); });
  }

  private async editable(tx: WriteTx, contextId: string) {
    const context = requireValue(await tx.objectStore("contexts").get(contextId), "작업 공간을 찾을 수 없습니다.");
    const pending = await tx.objectStore("meta").get("activeRun");
    if (pending?.contextId === contextId) throw new Error("진행 중인 검토를 먼저 완료하거나 취소해 주세요.");
    return context;
  }

  async createContext(name: string, input: ResumeInput): Promise<string> {
    if (!name.trim() || !input.document) throw new Error("작업 이름과 이력서를 확인해 주세요.");
    return this.write(async tx => {
      const id = uuid(), versionId = uuid(), createdAt = now();
      await tx.objectStore("contexts").put({ id, name: name.trim(), createdAt, latestVersionId: versionId, userFeedback: "" });
      await tx.objectStore("resumeVersions").put({ ...input, status: "ready", id: versionId, contextId: id, version: 1, createdAt });
      return id;
    });
  }

  async addResumeVersion(contextId: string, input: ResumeInput, baseVersionId: string): Promise<void> {
    if (!input.document) throw new Error("변환한 이력서를 확인해 주세요.");
    await this.write(async tx => {
      const context = await this.editable(tx, contextId);
      if (context.latestVersionId !== baseVersionId) throw new Error("다른 화면에서 수정본이 저장됐습니다. 최신 내용을 확인해 주세요.");
      const old = requireValue(await tx.objectStore("resumeVersions").get(baseVersionId), "이전 이력서를 찾을 수 없습니다.");
      const id = uuid();
      const { original: _original, ...withoutOriginal } = old;
      await tx.objectStore("resumeVersions").put(withoutOriginal);
      await tx.objectStore("resumeVersions").put({ ...input, status: "ready", id, contextId, version: old.version + 1, createdAt: now() });
      await tx.objectStore("contexts").put({ ...context, latestVersionId: id });
    });
  }

  async saveMaterial(draft: MaterialDraft, materialId?: string, contextId?: string, baseVersionId?: string | null): Promise<string> {
    if (!draft.title.trim() || !draft.content.trim()) throw new Error("자료 제목과 내용을 입력해 주세요.");
    return this.write(async tx => {
      if (contextId) await this.editable(tx, contextId);
      const existing = materialId ? requireValue(await tx.objectStore("materials").get(materialId), "자료를 찾을 수 없습니다.") : undefined;
      if (existing?.deleted) throw new Error("삭제한 자료입니다.");
      if (existing && existing.currentVersionId !== baseVersionId) throw new Error("자료가 갱신됐습니다. 최신 내용을 다시 열어 주세요.");
      const id = existing?.id ?? uuid();
      const old = existing?.currentVersionId ? await tx.objectStore("materialVersions").get(existing.currentVersionId) : undefined;
      if (old && old.materialType !== draft.materialType) throw new Error("기존 자료의 종류는 변경할 수 없습니다.");
      if (old && old.title === draft.title.trim() && old.content === draft.content && old.source === draft.source) {
        if (contextId) await tx.objectStore("contextMaterials").put({ id: `${contextId}:${id}`, contextId, materialId: id });
        return id;
      }
      const versionId = uuid();
      await tx.objectStore("materialVersions").put({ ...draft, title: draft.title.trim(), id: versionId, materialId: id, version: (old?.version ?? 0) + 1, createdAt: now() });
      await tx.objectStore("materials").put({ id, materialType: draft.materialType, currentVersionId: versionId, deleted: false });
      if (contextId) await tx.objectStore("contextMaterials").put({ id: `${contextId}:${id}`, contextId, materialId: id });
      return id;
    });
  }

  async attachMaterial(contextId: string, materialIds: string | string[]): Promise<void> {
    await this.write(async tx => {
      await this.editable(tx, contextId);
      for (const materialId of typeof materialIds === "string" ? [materialIds] : materialIds) {
        const material = requireValue(await tx.objectStore("materials").get(materialId), "자료를 찾을 수 없습니다.");
        if (material.deleted || !material.currentVersionId) throw new Error("저장 완료된 자료를 선택해 주세요.");
        await tx.objectStore("contextMaterials").put({ id: `${contextId}:${materialId}`, contextId, materialId });
      }
    });
  }

  async detachMaterial(contextId: string, materialId: string): Promise<void> {
    await this.write(async tx => { await this.editable(tx, contextId); await tx.objectStore("contextMaterials").delete(`${contextId}:${materialId}`); });
  }

  private async collectMaterials(tx: WriteTx) {
    const pending = await tx.objectStore("meta").get("activeRun");
    const keep = new Set(Object.values(pending?.input.materialVersions ?? {}));
    for (const link of await tx.objectStore("reviewMaterials").getAll()) keep.add(link.materialVersionId);
    const materials = await tx.objectStore("materials").getAll();
    for (const material of materials) if (!material.deleted && material.currentVersionId) keep.add(material.currentVersionId);
    // ponytail: scan local material metadata on explicit deletion; index/reference counts if the library grows large.
    for (const version of await tx.objectStore("materialVersions").getAll()) if (!keep.has(version.id)) await tx.objectStore("materialVersions").delete(version.id);
    for (const material of materials) if (material.deleted && !(await tx.objectStore("materialVersions").index("materialId").count(material.id))) await tx.objectStore("materials").delete(material.id);
  }

  async deleteMaterial(materialId: string): Promise<void> {
    await this.write(async tx => {
      const material = requireValue(await tx.objectStore("materials").get(materialId), "자료를 찾을 수 없습니다.");
      // Archived identity keeps historical version references valid; hidden from the live library.
      await tx.objectStore("materials").put({ ...material, deleted: true, draft: undefined });
      for (const link of await tx.objectStore("contextMaterials").index("materialId").getAll(materialId)) await tx.objectStore("contextMaterials").delete(link.id);
      await this.collectMaterials(tx);
    });
  }

  async deleteContext(contextId: string): Promise<void> {
    await this.write(async tx => {
      await this.editable(tx, contextId);
      for (const review of await tx.objectStore("reviews").index("contextId").getAll(contextId)) {
        for (const link of await tx.objectStore("reviewMaterials").index("reviewId").getAll(review.id)) await tx.objectStore("reviewMaterials").delete(link.id);
        await tx.objectStore("reviews").delete(review.id);
      }
      for (const name of ["resumeVersions", "suggestions", "contextMaterials", "experienceDocuments"] as const) {
        for (const item of await tx.objectStore(name).index("contextId").getAll(contextId)) await tx.objectStore(name).delete(item.id);
      }
      await tx.objectStore("contexts").delete(contextId);
      await this.collectMaterials(tx);
    });
  }

  async setSuggestionFeedback(contextId: string, id: string, change: { rating?: Rating; decision?: Decision }): Promise<void> {
    await this.write(async tx => {
      const context = await this.editable(tx, contextId);
      const item = requireValue(await tx.objectStore("suggestions").get(id), "제안을 찾을 수 없습니다.");
      const latest = context.latestReviewId ? await tx.objectStore("reviews").get(context.latestReviewId) : undefined;
      if (item.contextId !== contextId || !latest?.suggestionIds.includes(id)) throw new Error("현재 작업 공간의 제안만 변경할 수 있습니다.");
      await tx.objectStore("suggestions").put({ ...item, ...change });
    });
  }

  async saveReviewFeedback(contextId: string, userFeedback: string): Promise<void> {
    await this.write(async tx => { const context = await this.editable(tx, contextId); await tx.objectStore("contexts").put({ ...context, userFeedback }); });
  }

  async setContextExperiences(contextId: string, experienceIds: string[]): Promise<void> {
    await this.write(async tx => {
      const context = await this.editable(tx, contextId);
      const ids = [...new Set(experienceIds)];
      for (const id of ids) {
        const experience = await tx.objectStore("experiences").get(id);
        if (!experience?.markdown?.trim() || !experience.metadata?.trim()) throw new Error("경험 기록에서 본문과 메타데이터를 먼저 저장해 주세요.");
      }
      await tx.objectStore("contexts").put({ ...context, selectedExperienceIds: ids });
    });
  }

  async prepareReview(contextId: string): Promise<PreparedReview> {
    const state = await this.load();
    if (state.activeRun) throw new Error("다른 검토가 진행 중입니다. 먼저 완료하거나 취소해 주세요.");
    const context = requireValue(state.contexts.find(c => c.id === contextId), "작업 공간을 찾을 수 없습니다.");
    const resume = requireValue(state.resumeVersions.find(v => v.id === context.latestVersionId), "이력서를 찾을 수 없습니다.");
    if (!resume.document || !resume.documentKind || resume.status !== "ready") throw new Error("이력서 추출을 완료해 주세요.");
    const memory = this.reviewMemory(state, context);
    const materialVersions: Record<string, string> = {};
    for (const link of state.contextMaterials.filter(l => l.contextId === contextId)) {
      const material = state.materials.find(m => m.id === link.materialId && !m.deleted);
      if (!material?.currentVersionId) throw new Error("자료의 미리보기를 확인하고 저장해 주세요.");
      materialVersions[material.id] = material.currentVersionId;
    }
    const hasJd = this.materialInputs(state, materialVersions).some(material => material.materialType === "jobPosting");
    // ponytail: compare at most 100 saved experiences directly; add retrieval if libraries exceed this bound.
    const experiences = hasJd ? state.experiences.filter(item => item.markdown?.trim() && item.metadata?.trim()).map(item => ({
      id: item.id, title: item.title, period: item.period, revision: item.revision, markdown: item.markdown!, metadata: item.metadata!,
    })) : [];
    if (experiences.length > 100 || JSON.stringify(experiences).length > 600_000) throw new Error("검토할 경험 자료가 너무 큽니다. 경험 본문을 간결하게 정리해 주세요.");
    const selectedExperienceIds = hasJd ? (context.selectedExperienceIds ?? []) : [];
    if (selectedExperienceIds.some(id => !experiences.some(item => item.id === id))) throw new Error("선택한 경험의 본문과 메타데이터를 확인해 주세요.");
    return { kind: resume.documentKind, document: resume.document,
      materials: this.materialInputs(state, materialVersions),
      reviewContext: { ...memory, resumeVersionId: resume.id, materialVersions, experiences, selectedExperienceIds } };
  }

  private reviewMemory(state: Workspace, context: Context, allowOpen = false) {
    const contextId = context.id;
    const previous = state.reviews.find(r => r.id === context.latestReviewId);
    const active = state.suggestions.filter(s => previous?.suggestionIds.includes(s.id));
    if (!allowOpen && active.some(s => s.decision === "open")) throw new Error("각 제안에 Resolve 또는 Skip을 선택해 주세요.");
    const feedback = state.suggestions.filter(s => s.contextId === contextId && s.decision !== "open" && (s.decision === "skip" || active.some(a => a.id === s.id)))
      .map(s => ({ id: s.id, contextId, reviewId: s.reviewId, decision: s.decision as "resolve" | "skip", rating: s.rating, suggestion: s.content }));
    const resolved = (previous?.resolutionChecks ?? []).filter(c => c.status === "resolved").map(check => ({
      suggestionId: check.suggestionId, reason: check.reason,
      quote: requireValue(state.suggestions.find(s => s.id === check.suggestionId), "이전 제안을 찾을 수 없습니다.").content.수정포인트위치.quote,
    }));
    return { contextId, previousReviewId: previous?.id ?? null, feedback, resolved, userFeedback: context.userFeedback || null };
  }

  async prepareRetry(reviewId: string): Promise<ReviewRecord> {
    const record = await this.restoreRecord(reviewId);
    const state = await this.load();
    if (state.activeRun) throw new Error("진행 중인 검토를 먼저 완료하거나 취소해 주세요.");
    const context = requireValue(state.contexts.find(c => c.id === record.reviewContext?.contextId), "작업 공간을 찾을 수 없습니다.");
    if (context.lastAttemptId !== reviewId) throw new Error("최신 검토 기록을 확인하고 다시 실행해 주세요.");
    // Retry the pinned document/materials, but respect decisions made since that attempt.
    if (!record.response.errors.some(error => error.canRetry)) throw new Error("다시 실행할 오류가 없습니다.");
    return { ...record, reviewContext: { ...record.reviewContext!, ...this.reviewMemory(state, context, true) } };
  }

  private materialInputs(state: Workspace, references: Record<string, string>): ReferenceMaterial[] {
    return Object.entries(references).map(([sourceId, versionId]) => {
      const version = requireValue(state.materialVersions.find(v => v.id === versionId && v.materialId === sourceId), "검토에 사용한 자료 버전을 찾을 수 없습니다.");
      return version.legacyUrl
        ? { sourceId, materialType: version.materialType, inputType: "url", content: null, url: version.legacyUrl }
        : { sourceId, materialType: version.materialType, inputType: "document", content: version.content, url: null };
    });
  }

  async registerRun(runId: string, input: PreparedReview): Promise<void> {
    await this.write(async tx => {
      const existing = await tx.objectStore("meta").get("activeRun");
      if (existing) throw new Error("이미 진행 중인 검토가 있습니다.");
      const context = requireValue(await tx.objectStore("contexts").get(input.reviewContext.contextId), "작업 공간을 찾을 수 없습니다.");
      const version = await tx.objectStore("resumeVersions").get(input.reviewContext.resumeVersionId);
      if (version?.contextId !== context.id) throw new Error("이력서 연결이 올바르지 않습니다.");
      for (const [materialId, versionId] of Object.entries(input.reviewContext.materialVersions ?? {})) {
        const material = await tx.objectStore("materialVersions").get(versionId);
        if (material?.materialId !== materialId) throw new Error("검토 자료가 변경됐습니다. 다시 시작해 주세요.");
      }
      for (const feedback of input.reviewContext.feedback ?? []) {
        const suggestion = await tx.objectStore("suggestions").get(feedback.id);
        if (suggestion?.contextId !== context.id || suggestion.reviewId !== feedback.reviewId) throw new Error("이전 제안 연결이 올바르지 않습니다.");
      }
      await tx.objectStore("meta").put({ runId, contextId: context.id, input: refs(input.reviewContext) }, "activeRun");
    });
  }

  async clearActiveRun(runId: string): Promise<void> {
    await this.write(async tx => {
      const active = await tx.objectStore("meta").get("activeRun");
      if (active?.runId === runId) {
        await tx.objectStore("meta").delete("activeRun");
        await this.collectMaterials(tx);
      }
    });
  }

  async completeReview(record: ReviewRecord): Promise<void> {
    await this.write(async tx => {
      // Multiple tabs may receive the same terminal event. A committed record is already complete.
      if (await tx.objectStore("reviews").get(record.runId)) return;
      const active = requireValue(await tx.objectStore("meta").get("activeRun"), "저장할 실행을 찾을 수 없습니다.");
      if (active.runId !== record.runId) throw new Error("다른 실행의 결과는 저장할 수 없습니다.");
      if (record.reviewContext && (record.reviewContext.contextId !== active.contextId || record.reviewContext.resumeVersionId !== active.input.resumeVersionId)) throw new Error("검토 결과의 작업 공간이 일치하지 않습니다.");
      const context = requireValue(await tx.objectStore("contexts").get(active.contextId), "작업 공간을 찾을 수 없습니다.");
      if (record.response.status === "cancelled") { await tx.objectStore("meta").delete("activeRun"); await this.collectMaterials(tx); return; }
      if (!record.reviewContext) {
        // A version-1 in-flight run predates context IDs. Recover its actual input before normalizing it.
        active.input.materialVersions = await this.pinLegacyMaterials(tx, record.materials);
        const version = await tx.objectStore("resumeVersions").get(active.input.resumeVersionId);
        if (!version || JSON.stringify(version.document) !== JSON.stringify(record.document)) {
          const id = uuid();
          await tx.objectStore("resumeVersions").put({ id, contextId: context.id, version: 0, createdAt: record.createdAt,
            inputType: "text", displayName: "이전 실행 원문", status: "ready", document: record.document,
            documentKind: "pages" in record.document ? "page" : "flow" });
          active.input.resumeVersionId = id;
        }
      }
      const previous = context.latestReviewId ? await tx.objectStore("reviews").get(context.latestReviewId) : undefined;
      const successful = record.response.status === "success" || record.response.status === "partial";
      const resultIds: string[] = [], suggestionIds: string[] = [];
      const checks = record.response.resolutionChecks ?? [];
      if (successful) {
        for (const raw of record.response.results) {
          const content = normalizedSuggestion(raw);
          const old = content.previousSuggestionId ? await tx.objectStore("suggestions").get(content.previousSuggestionId) : undefined;
          if (content.previousSuggestionId && (!old || old.contextId !== context.id)) throw new Error("다른 작업 공간의 제안입니다.");
          const id = content.id!;
          if (await tx.objectStore("suggestions").get(id)) throw new Error("중복된 제안 식별자입니다.");
          await tx.objectStore("suggestions").put({ id, contextId: context.id, reviewId: record.runId,
            resumeVersionId: active.input.resumeVersionId, content, rating: old?.rating ?? null, decision: "open",
            verification: checks.find(c => c.suggestionId === old?.id) });
          resultIds.push(id); suggestionIds.push(id);
        }
        for (const feedback of active.input.feedback) {
          if (feedback.decision !== "resolve") continue;
          const old = requireValue(await tx.objectStore("suggestions").get(feedback.id), "이전 제안을 찾을 수 없습니다.");
          if (old.contextId !== context.id) throw new Error("다른 작업 공간의 제안입니다.");
          const check = checks.find(c => c.suggestionId === old.id) ?? { suggestionId: old.id, status: "uncertain" as const, reason: "수정 반영 결과를 확인하지 못했습니다.", evidence: null };
          const continued = record.response.results.some(s => s.previousSuggestionId === old.id);
          if (check.status !== "resolved" && !continued) {
            await tx.objectStore("suggestions").put({ ...old, decision: "open", verification: check });
            suggestionIds.push(old.id);
          }
        }
      }
      const { finalReview, ...modules } = record.moduleResults;
      const review: Review = { id: record.runId, contextId: context.id, resumeVersionId: active.input.resumeVersionId,
        createdAt: record.createdAt, input: active.input, status: record.response.status, errors: record.response.errors,
        materialReviews: record.response.materialReviews, experienceRecommendations: record.response.experienceRecommendations ?? [], resolutionChecks: checks, resultIds, suggestionIds: successful ? suggestionIds : (previous?.suggestionIds ?? []),
        modules, finalErrors: finalReview.errors, finalFailed: finalReview.output == null };
      await tx.objectStore("reviews").put(review);
      for (const versionId of Object.values(active.input.materialVersions ?? {})) {
        requireValue(await tx.objectStore("materialVersions").get(versionId), "검토 자료 버전이 없습니다.");
        await tx.objectStore("reviewMaterials").put({ id: `${review.id}:${versionId}`, reviewId: review.id, materialVersionId: versionId });
      }
      await tx.objectStore("contexts").put({ ...context, lastAttemptId: review.id, latestReviewId: successful ? review.id : context.latestReviewId });
      await tx.objectStore("meta").delete("activeRun");
    });
  }

  async restoreRecord(reviewId: string): Promise<ReviewRecord> {
    const state = await this.load();
    const review = requireValue(state.reviews.find(r => r.id === reviewId), "검토 기록을 찾을 수 없습니다.");
    const resume = requireValue(state.resumeVersions.find(v => v.id === review.resumeVersionId), "원문 버전이 없는 이전 검토입니다. 새 검토를 시작해 주세요.");
    const document = requireValue(resume.document, "이력서 추출 내용을 찾을 수 없습니다.");
    const results = review.resultIds.map(id => requireValue(state.suggestions.find(s => s.id === id), "제안을 찾을 수 없습니다.").content);
    const reviewContext: ReviewContext = { ...review.input, feedback: review.input.feedback.map(reference => ({ ...reference,
      suggestion: requireValue(state.suggestions.find(s => s.id === reference.id && s.contextId === review.contextId), "이전 제안 연결이 올바르지 않습니다.").content })) };
    return { runId: review.id, createdAt: review.createdAt, document, materials: this.materialInputs(state, review.input.materialVersions ?? {}), reviewContext,
      response: { status: review.status, errors: review.errors, materialReviews: review.materialReviews, experienceRecommendations: review.experienceRecommendations ?? [], resolutionChecks: review.resolutionChecks, results },
      moduleResults: { ...review.modules, finalReview: { moduleKey: "finalReview", errors: review.finalErrors,
        output: review.finalFailed ? null : { materialReviews: review.materialReviews, experienceRecommendations: review.experienceRecommendations ?? [], resolutionChecks: review.resolutionChecks, results } } } };
  }

  private async pinLegacyMaterials(tx: WriteTx, materials: ReferenceMaterial[]) {
    const references: Record<string, string> = {};
    for (const item of materials) {
      const current = await tx.objectStore("materials").get(item.sourceId);
      const version = current?.currentVersionId ? await tx.objectStore("materialVersions").get(current.currentVersionId) : undefined;
      const content = item.content ?? item.url ?? "";
      const id = version && !item.url && version.content === content ? version.id : uuid();
      if (id !== version?.id) {
        await tx.objectStore("materialVersions").put({ id, materialId: item.sourceId, version: 1, createdAt: now(),
          title: "이전 검토 자료", materialType: item.materialType, source: item.url ?? "이전 검토", content,
          ...(item.url ? { legacyUrl: item.url } : {}) });
        if (!current) await tx.objectStore("materials").put({ id: item.sourceId, currentVersionId: null, deleted: true, materialType: item.materialType });
      }
      references[item.sourceId] = id;
    }
    return references;
  }

  // Legacy data is untyped and confined to this one-time conversion boundary.
  private async migrate(tx: WriteTx, legacy: any): Promise<void> {
    if (!legacy) return;
    const contextId = uuid(), versionId = uuid(), createdAt = now();
    const hasContext = !!(legacy.activeResume || legacy.currentReview || legacy.lastReview || legacy.reviewRecord);
    const context: Context = { id: contextId, name: legacy.activeResume?.displayName ?? "이전 이력서", latestVersionId: versionId, createdAt, userFeedback: legacy.lastReview?.userFeedback ?? "" };
    if (legacy.activeResume) await tx.objectStore("resumeVersions").put({ ...legacy.activeResume, id: versionId, contextId, version: 1, createdAt });
    for (const item of legacy.materials ?? []) {
      const id = item.sourceId ?? uuid(), materialVersionId = uuid();
      const draft: MaterialDraft = { title: item.displayName || "이전 자료", materialType: item.materialType, content: item.content ?? "", source: item.url ?? item.displayName ?? "직접 입력" };
      await tx.objectStore("materials").put({ id, materialType: item.materialType, deleted: false, currentVersionId: item.content ? materialVersionId : null,
        ...(item.content ? {} : { draft: { ...draft, original: item.original } }) });
      if (item.content) await tx.objectStore("materialVersions").put({ ...draft, id: materialVersionId, materialId: id, version: 1, createdAt });
      if (hasContext) await tx.objectStore("contextMaterials").put({ id: `${contextId}:${id}`, contextId, materialId: id });
    }
    if (!hasContext) return;
    const record = legacy.reviewRecord;
    const response = record?.response ?? legacy.currentReview ?? (legacy.lastReview ? { status: "success", results: legacy.lastReview.results, errors: [], materialReviews: [] } : undefined);
    if (response) {
      const reviewId = record?.runId ?? uuid();
      let reviewedVersionId: string | null = legacy.activeResume ? versionId : null;
      if (record?.document && JSON.stringify(record.document) !== JSON.stringify(legacy.activeResume?.document)) {
        reviewedVersionId = uuid();
        await tx.objectStore("resumeVersions").put({ id: reviewedVersionId, contextId, version: 1, createdAt: record.createdAt ?? createdAt,
          inputType: "text", displayName: "이전 검토 원문", status: "ready", document: record.document,
          documentKind: "pages" in record.document ? "page" : "flow" });
        if (legacy.activeResume) {
          await tx.objectStore("resumeVersions").put({ ...legacy.activeResume, id: versionId, contextId, version: 2, createdAt });
        } else context.latestVersionId = reviewedVersionId;
      } else if (!record && !legacy.currentReview) reviewedVersionId = null;
      const materialVersions = await this.pinLegacyMaterials(tx, record?.materials ?? []);
      for (const id of Object.values(materialVersions)) await tx.objectStore("reviewMaterials").put({ id: `${reviewId}:${id}`, reviewId, materialVersionId: id });
      const resultIds: string[] = [];
      for (const raw of response.results ?? []) {
        const content = normalizedSuggestion(raw), id = content.id!;
        await tx.objectStore("suggestions").put({ id, contextId, reviewId, resumeVersionId: reviewedVersionId, content, rating: null, decision: "open" });
        resultIds.push(id);
      }
      const { finalReview, ...modules } = record?.moduleResults ?? { spellCheck: { moduleKey: "spellCheck", output: [], errors: [] } };
      await tx.objectStore("reviews").put({ id: reviewId, contextId, resumeVersionId: reviewedVersionId, createdAt: record?.createdAt ?? createdAt,
        input: { contextId, resumeVersionId: reviewedVersionId ?? versionId, previousReviewId: null, feedback: [], resolved: [], materialVersions, userFeedback: context.userFeedback },
        status: response.status, errors: response.errors ?? [], materialReviews: response.materialReviews ?? [], resolutionChecks: [], resultIds, suggestionIds: resultIds,
        modules, finalErrors: finalReview?.errors ?? [], finalFailed: finalReview?.output === null });
      context.latestReviewId = reviewId; context.lastAttemptId = reviewId;
      if (response.status !== "success" && response.status !== "partial" && legacy.lastReview) {
        const successfulId = uuid(), ids: string[] = [];
        for (const raw of legacy.lastReview.results ?? []) {
          const content = normalizedSuggestion(raw), id = content.id!;
          await tx.objectStore("suggestions").put({ id, contextId, reviewId: successfulId, resumeVersionId: null,
            content, rating: null, decision: "open" });
          ids.push(id);
        }
        // lastReview has no proven original or modules. Preserve its suggestions separately from the failed attempt.
        await tx.objectStore("reviews").put({ id: successfulId, contextId, resumeVersionId: null, createdAt,
          input: { contextId, resumeVersionId: versionId, materialVersions: {}, feedback: [], resolved: [] },
          status: "success", errors: [], materialReviews: [], resolutionChecks: [], resultIds: ids, suggestionIds: ids,
          modules: { spellCheck: { moduleKey: "spellCheck", output: [], errors: [] } }, finalErrors: [], finalFailed: false });
        context.latestReviewId = successfulId;
      }
    }
    if (!(await tx.objectStore("resumeVersions").get(context.latestVersionId))) {
      // Version zero marks a migrated workspace whose original was already deleted; the first upload becomes v1.
      await tx.objectStore("resumeVersions").put({ id: context.latestVersionId, contextId, version: 0, createdAt,
        inputType: "text", displayName: "이전 원문 없음", status: "failed" });
    }
    await tx.objectStore("contexts").put(context);
    // Old in-flight runs have no pinned context input. Keep their ID so the UI can cancel/recover them explicitly.
    if (legacy.activeRunId) await tx.objectStore("meta").put({ runId: legacy.activeRunId, contextId,
      input: { contextId, resumeVersionId: versionId, materialVersions: {}, feedback: [], resolved: [], previousReviewId: null } }, "activeRun");
  }
}

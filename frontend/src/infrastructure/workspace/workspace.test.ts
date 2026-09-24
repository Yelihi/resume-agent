import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { IndexedDbWorkspaceRepository } from "./IndexedDbWorkspaceRepository";
import { resumeInput, materialDraft, reviewRecord, suggestion } from "../../test/fixtures";

const store = () => new IndexedDbWorkspaceRepository(`workspace-${crypto.randomUUID()}`);

async function finish(db: IndexedDbWorkspaceRepository, contextId: string, results = [suggestion()]) {
  const input = await db.prepareReview(contextId);
  const record = reviewRecord(input, results);
  await db.registerRun(record.runId, input);
  await db.completeReview(record);
  return record;
}

describe("context workspace", () => {
  it("separates identical resumes and preserves versions while retaining only the latest original", async () => {
    const db = store();
    const a = await db.createContext("A", resumeInput());
    const b = await db.createContext("B", resumeInput());
    const before = await db.load();
    const first = before.resumeVersions.find(v => v.contextId === a)!;
    await db.addResumeVersion(a, resumeInput("수정한 내용"), first.id);
    const after = await db.load();
    expect(after.contexts).toHaveLength(2);
    expect(after.resumeVersions.filter(v => v.contextId === a).map(v => v.version)).toEqual([1, 2]);
    expect(after.resumeVersions.find(v => v.id === first.id)?.original).toBeUndefined();
    expect(after.resumeVersions.find(v => v.contextId === b)?.original).toBeDefined();
    await expect(db.addResumeVersion(a, resumeInput(), first.id)).rejects.toThrow();
    expect((await db.load()).resumeVersions).toHaveLength(3);
  });

  it("freezes material versions for reviews, shares references, and does not store duplicate input bodies", async () => {
    const db = store();
    const c = await db.createContext("A", resumeInput());
    const m = await db.saveMaterial(materialDraft(), undefined, c);
    const first = await finish(db, c, []);
    const snapshot = await db.load();
    const old = snapshot.materials[0].currentVersionId;
    await db.saveMaterial(materialDraft("새 자료 내용"), m, undefined, old);
    const next = await db.prepareReview(c);
    expect(next.materials[0].content).toBe("새 자료 내용");
    const restored = await db.restoreRecord(first.runId);
    expect(restored.materials[0].content).toBe("React 경험");
    const persisted = (await db.load()).reviews[0];
    expect(persisted).not.toHaveProperty("document");
    expect(persisted).not.toHaveProperty("materials");
    const current = (await db.load()).materials[0].currentVersionId;
    await db.saveMaterial(materialDraft("새 자료 내용"), m, undefined, current);
    expect((await db.load()).materialVersions).toHaveLength(2);
    await db.deleteMaterial(m);
    expect((await db.load()).contextMaterials).toEqual([]);
    expect((await db.restoreRecord(first.runId)).materials[0].content).toBe("React 경험");
  });

  it("requires decisions, preserves skip within its context and keeps ratings independent", async () => {
    const db = store();
    const a = await db.createContext("A", resumeInput());
    const b = await db.createContext("B", resumeInput());
    await finish(db, a);
    const id = (await db.load()).suggestions[0].id;
    await db.setSuggestionFeedback(a, id, { rating: "down" });
    await expect(db.prepareReview(a)).rejects.toThrow();
    await db.setSuggestionFeedback(a, id, { decision: "skip" });
    const input = await db.prepareReview(a);
    expect(input.reviewContext.feedback![0]).toMatchObject({ id, decision: "skip", rating: "down" });
    expect((await db.prepareReview(b)).reviewContext.feedback).toEqual([]);
    await expect(db.setSuggestionFeedback(b, id, { decision: "resolve" })).rejects.toThrow();
    await finish(db, a, []);
    expect((await db.prepareReview(a)).reviewContext.feedback![0].decision).toBe("skip");
  });

  it("removes confirmed results and sends resolved memory for just one subsequent review", async () => {
    const db = store();
    const c = await db.createContext("A", resumeInput());
    await finish(db, c);
    const id = (await db.load()).suggestions[0].id;
    await db.setSuggestionFeedback(c, id, { decision: "resolve" });
    const input = await db.prepareReview(c);
    const record = reviewRecord(input, []);
    record.response.resolutionChecks = [{ suggestionId: id, status: "resolved", reason: "반영됨", evidence: null }];
    await db.registerRun(record.runId, input);
    await db.completeReview(record);
    expect((await db.prepareReview(c)).reviewContext.resolved).toHaveLength(1);
    await finish(db, c, []);
    expect((await db.prepareReview(c)).reviewContext.resolved).toEqual([]);
  });

  it("preserves old results on failure, keeps unconfirmed suggestions and prevents stale completions", async () => {
    const db = store();
    const c = await db.createContext("A", resumeInput());
    await finish(db, c);
    const id = (await db.load()).suggestions[0].id;
    await db.setSuggestionFeedback(c, id, { decision: "resolve" });
    const input = await db.prepareReview(c);
    const record = reviewRecord(input, []);
    record.response.resolutionChecks = [{ suggestionId: id, status: "uncertain", reason: "확인 필요", evidence: null }];
    await db.registerRun(record.runId, input);
    await db.completeReview(record);
    await expect(db.prepareReview(c)).rejects.toThrow();
    expect((await db.load()).suggestions.find(s => s.id === id)?.decision).toBe("open");
    await expect(db.completeReview({ ...record, runId: "foreign" })).rejects.toThrow();
  });

  it("deletes only context-owned data and collects unreferenced archived material versions", async () => {
    const db = store();
    const a = await db.createContext("A", resumeInput());
    const b = await db.createContext("B", resumeInput());
    const m = await db.saveMaterial(materialDraft(), undefined, a);
    await db.attachMaterial(b, m);
    await finish(db, a, []);
    await db.detachMaterial(a, m);
    expect((await db.load()).contextMaterials).toHaveLength(1);
    await db.deleteContext(a);
    const state = await db.load();
    expect(state.contexts.map(c => c.id)).toEqual([b]);
    expect(state.reviews).toEqual([]);
    expect(state.materials).toHaveLength(1);
    await db.deleteMaterial(m);
    expect((await db.load()).materialVersions).toEqual([]);
  });

  it("migrates the legacy single state once without losing originals, results or pending materials", async () => {
    const name = `legacy-${crypto.randomUUID()}`;
    const legacy = await openDB(name, 1, { upgrade(db) { db.createObjectStore("state"); } });
    await legacy.put("state", { activeResume: { ...resumeInput(), status: "ready" },
      currentReview: { status: "success", errors: [], results: [suggestion()], materialReviews: [] },
      lastReview: { results: [suggestion()], userFeedback: "간결하게" },
      materials: [{ sourceId: "old-material", displayName: "채용", materialType: "jobPosting", inputType: "text", content: "React", status: "extracted" }],
    }, "app");
    legacy.close();
    const db = new IndexedDbWorkspaceRepository(name);
    const state = await db.load();
    expect(state.contexts).toHaveLength(1);
    expect(state.resumeVersions[0].original).toBeDefined();
    expect(state.suggestions[0].decision).toBe("open");
    expect(state.contexts[0].userFeedback).toBe("간결하게");
    expect(state.materialVersions[0].content).toBe("React");
    expect((await db.load()).contexts).toHaveLength(1);
  });
});

it("pins in-flight materials through deletion, commits once across tabs, and collects cancelled pins", async () => {
  const db = store();
  const a = await db.createContext("A", resumeInput());
  const materialId = await db.saveMaterial(materialDraft(), undefined, a);
  const input = await db.prepareReview(a), record = reviewRecord(input, []);
  await db.registerRun(record.runId, input);
  await db.deleteMaterial(materialId);
  expect((await db.load()).materialVersions).toHaveLength(1);
  await expect(db.deleteContext(a)).rejects.toThrow();
  await db.completeReview(record);
  await db.completeReview(record);
  expect((await db.load()).reviews).toHaveLength(1);
  expect((await db.restoreRecord(record.runId)).materials[0].content).toBe(materialDraft().content);
  await db.deleteContext(a);
  expect((await db.load()).materialVersions).toHaveLength(0);

  const b = await db.createContext("B", resumeInput());
  const second = await db.saveMaterial(materialDraft(), undefined, b);
  const pending = await db.prepareReview(b);
  await db.registerRun("cancelled-run", pending);
  await db.deleteMaterial(second);
  await db.clearActiveRun("cancelled-run");
  expect((await db.load()).materialVersions).toHaveLength(0);
});

it("rejects a deleted material snapshot before accepting a server run", async () => {
  const db = store();
  const a = await db.createContext("A", resumeInput());
  const m = await db.saveMaterial(materialDraft(), undefined, a);
  const prepared = await db.prepareReview(a);
  await db.deleteMaterial(m);
  await expect(db.registerRun("orphan", prepared)).rejects.toThrow("자료가 변경");
  expect((await db.load()).activeRun).toBeUndefined();
});

it("migrates the actual reviewed document separately and recovers legacy in-flight URL inputs", async () => {
  const source = store(), context = await source.createContext("old", resumeInput("이전 원문"));
  const record = reviewRecord(await source.prepareReview(context), []);
  record.reviewContext = null;
  record.materials = [{ sourceId: "url", materialType: "jobPosting", inputType: "url", url: "https://example.com/job", content: null }];
  record.moduleResults.jobPostingAnalysis = { moduleKey: "jobPostingAnalysis", output: { summary: "공고", evidence: [] }, errors: [] };
  const name = `legacy-review-${crypto.randomUUID()}`;
  const legacy = await openDB(name, 1, { upgrade(db) { db.createObjectStore("state"); } });
  await legacy.put("state", { activeResume: { ...resumeInput("최신 원문"), status: "ready" }, reviewRecord: record,
    activeRunId: "in-flight", materials: [] }, "app");
  legacy.close();
  const db = new IndexedDbWorkspaceRepository(name);
  const state = await db.load();
  expect(state.resumeVersions).toHaveLength(2);
  expect((await db.restoreRecord(record.runId)).document).toEqual(resumeInput("이전 원문").document);
  await db.completeReview({ ...record, runId: "in-flight", document: resumeInput("최신 원문").document });
  const recovered = await db.restoreRecord("in-flight");
  expect(recovered.materials).toEqual(record.materials);
  expect(recovered.document).toEqual(resumeInput("최신 원문").document);
  expect((await db.load()).activeRun).toBeUndefined();
});

it.each(["record", "current"])("preserves last successful suggestions and failed history during %s migration", async (format) => {
  const source = store(), id = await source.createContext("A", resumeInput());
  const failed = reviewRecord(await source.prepareReview(id), []);
  failed.response.status = "failed";
  failed.response.errors = [{ moduleKey: "finalReview", inputSourceId: null, errorCode: "AI_FAILED", userMessage: "실패", canRetry: true }];
  failed.moduleResults.finalReview = { moduleKey: "finalReview", output: null, errors: failed.response.errors };
  const previous = suggestion();
  const name = `failed-legacy-${crypto.randomUUID()}`;
  const legacy = await openDB(name, 1, { upgrade(db) { db.createObjectStore("state"); } });
  await legacy.put("state", { activeResume: { ...resumeInput(), status: "ready" }, materials: [],
    ...(format === "record" ? { reviewRecord: failed } : { currentReview: failed.response }),
    lastReview: { results: [previous], userFeedback: "근거 중심으로" } }, "app");
  legacy.close();
  const migrated = new IndexedDbWorkspaceRepository(name), state = await migrated.load();
  const context = state.contexts[0];
  expect(state.suggestions.map(s => s.content)).toContainEqual(previous);
  expect(state.reviews.find(r => r.id === context.latestReviewId)?.status).toBe("success");
  expect(state.reviews.find(r => r.id === context.lastAttemptId)?.status).toBe("failed");
  expect(context.latestReviewId).not.toBe(context.lastAttemptId);
  expect(context.userFeedback).toBe("근거 중심으로");
  expect(state.suggestions[0].resumeVersionId).toBeNull();
});

it("allows uploading a first available resume after migrating a deleted legacy resume", async () => {
  const name = `deleted-legacy-${crypto.randomUUID()}`;
  const legacy = await openDB(name, 1, { upgrade(db) { db.createObjectStore("state"); } });
  await legacy.put("state", { lastReview: { results: [suggestion()] }, materials: [] }, "app");
  legacy.close();
  const migrated = new IndexedDbWorkspaceRepository(name), context = (await migrated.load()).contexts[0];
  await migrated.addResumeVersion(context.id, resumeInput("새 이력서"), context.latestVersionId);
  const state = await migrated.load(), current = state.contexts[0];
  expect(state.resumeVersions.find(v => v.id === current.latestVersionId)).toMatchObject({ version: 1, document: resumeInput("새 이력서").document });
  expect(state.suggestions).toHaveLength(1);
  expect(state.suggestions[0].resumeVersionId).toBeNull();
  await expect(migrated.addResumeVersion(context.id, resumeInput(), context.latestVersionId)).rejects.toThrow("다른 화면");
});

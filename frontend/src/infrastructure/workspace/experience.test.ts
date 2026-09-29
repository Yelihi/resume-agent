// @vitest-environment node
import { expect, it } from "vitest";
import { openDB } from "idb";
import { IndexedDbWorkspaceRepository } from "./IndexedDbWorkspaceRepository";
import { resumeInput } from "../../test/fixtures";
import type { ExperienceSource, WritingInput, WritingResult } from "../../domain/experience/entities";
const source = (text = "중복 요청을 찾아 요청을 한 번만 보내도록 변경했다."): ExperienceSource => ({ id: crypto.randomUUID(), kind: "note", name: "로그인 요청 개선", text, createdAt: new Date().toISOString() });
const result: WritingResult = { markdown: "# 로그인 요청 개선\n\n기간 확인 필요\n\n## 이력서용 요약\n\n- 중복 요청을 제거했다.\n\n## 상세 설명\n\n중복 요청이 발생하는 조건을 확인했다.\n\n## 근거\n\n작업 메모", summary: "- 중복 요청을 제거했다.", questions: ["어떤 조건에서 중복 요청이 발생했나요?"], sourceNotes: [] };

it("migrates an existing v2 database without losing its context", async () => {
  const name = `experience-migration-${crypto.randomUUID()}`;
  const db = await openDB(name, 2, { upgrade(db) {
    db.createObjectStore("contexts", { keyPath: "id" });
    for (const name of ["resumeVersions", "reviews", "suggestions"]) db.createObjectStore(name, { keyPath: "id" }).createIndex("contextId", "contextId");
    db.createObjectStore("materials", { keyPath: "id" });
    db.createObjectStore("materialVersions", { keyPath: "id" }).createIndex("materialId", "materialId");
    const links = db.createObjectStore("contextMaterials", { keyPath: "id" }); links.createIndex("contextId", "contextId"); links.createIndex("materialId", "materialId");
    const reviews = db.createObjectStore("reviewMaterials", { keyPath: "id" }); reviews.createIndex("reviewId", "reviewId"); reviews.createIndex("materialVersionId", "materialVersionId");
    db.createObjectStore("meta");
  } });
  await db.put("contexts", { id: "existing", name: "기존 이력서", latestVersionId: "resume", createdAt: "2026-09-01", userFeedback: "유지" }); db.close();
  const state = await new IndexedDbWorkspaceRepository(name).load();
  expect(state.contexts[0]).toMatchObject({ name: "기존 이력서", userFeedback: "유지" });
  expect(state.experiences).toEqual([]);
});

it("keeps append-only sources and independent context documents, rejects stale saves and preserves sources on context deletion", async () => {
  const store = new IndexedDbWorkspaceRepository(`experience-store-${crypto.randomUUID()}`);
  const a = await store.createContext("A", resumeInput());
  const b = await store.createContext("B", resumeInput());
  const original = { ...source(), kind: "file" as const, original: new Blob(["original bytes"]) };
  const experienceId = await store.saveExperience({ title: "로그인", period: "2026.08", sources: [original] });
  const state = await store.load();
  const experience = state.experiences[0];
  const makeDocument = (contextId: string) => {
    const { original: _blob, ...textSource } = original;
    const input: WritingInput = { experience: { ...experience, sources: [textSource] }, resume: { id: state.contexts.find(item => item.id === contextId)!.latestVersionId, text: "이력서" }, materials: [] };
    return { ...result, id: `${contextId}:${experienceId}`, contextId, experienceId, input };
  };
  const docA = makeDocument(a), docB = makeDocument(b);
  await store.saveExperienceDocument(docA); await store.saveExperienceDocument(docB);
  await store.saveExperience({ title: "로그인", period: "2026.08", sources: [source("측정 결과를 추가했다.")] }, experienceId, 1);
  await expect(store.saveExperience({ title: "로그인", period: "", sources: [source()] }, experienceId, 1)).rejects.toThrow("변경");
  await store.saveExperienceDocument({ ...docA, markdown: "A만 수정" }, 1);
  await expect(store.saveExperienceDocument({ ...docA, markdown: "오래된 수정" }, 1)).rejects.toThrow("다른 화면");
  const latest = await store.load();
  expect(latest.experienceDocuments.find(item => item.id === docB.id)?.markdown).toBe(result.markdown);
  expect(latest.experiences[0].sources[0].text).toBe(original.text);
  expect(await (latest.experiences[0].sources[0].original as Blob).text()).toBe("original bytes");
  expect(latest.experienceDocuments[0].input.experience.revision).toBe(1);
  await store.deleteContext(a);
  expect(store.getSnapshot().experienceDocuments.map(item => item.contextId)).toEqual([b]);
  expect(store.getSnapshot().experiences[0].sources).toHaveLength(2);
});

it("removes only explicitly selected sources on save and preserves editable historical documents", async () => {
  const store = new IndexedDbWorkspaceRepository(`experience-removal-${crypto.randomUUID()}`);
  const contextId = await store.createContext("A", resumeInput());
  const original = source(), kept = source("남길 원본"), appended = source("새 원본");
  const experienceId = await store.saveExperience({ title: "작업", period: "", sources: [original, kept] });
  const state = store.getSnapshot();
  const document = { ...result, id: "history", contextId, experienceId,
    input: { experience: state.experiences[0], resume: { id: state.contexts[0].latestVersionId!, text: "이력서" }, materials: [] },
    sourceNotes: [{ sourceId: original.id, text: "원본 참고", verified: true }] };
  await store.saveExperienceDocument(document);
  const update = { title: "작업", period: "", sources: [appended], removedSourceIds: [original.id] };
  const before = await store.load();
  for (const removedSourceIds of [["unknown"], [original.id, original.id]]) {
    await expect(store.saveExperience({ ...update, removedSourceIds }, experienceId, 1)).rejects.toThrow("삭제할 원본");
    expect(await store.load()).toEqual(before);
  }
  await expect(store.saveExperience(update, experienceId, 2)).rejects.toThrow("변경");
  await store.saveExperience(update, experienceId, 1);
  expect(store.getSnapshot().experiences[0].sources).toEqual([kept, appended]);
  expect(store.getSnapshot().experiences[0]).not.toHaveProperty("removedSourceIds");
  await store.saveExperienceDocument({ ...document, markdown: "과거 작성본 수정" }, 1);
  await expect(store.saveExperienceDocument({ ...document, id: "new-history" })).rejects.toThrow("원본 연결");
  await expect(store.saveExperienceDocument({ ...document, input: { ...document.input, experience: {
    ...document.input.experience, sources: [{ ...original, text: "위조된 원본" }],
  } } }, 2)).rejects.toThrow("원본 연결");
  await store.saveExperience({ title: "작업", period: "", sources: [], removedSourceIds: [kept.id] }, experienceId, 2);
  expect(store.getSnapshot().experiences[0].sources).toEqual([appended]);
});

it("applies the source count limit after removal", async () => {
  const store = new IndexedDbWorkspaceRepository(`experience-limit-${crypto.randomUUID()}`);
  const sources = Array.from({ length: 100 }, () => source());
  const id = await store.saveExperience({ title: "작업", period: "", sources });
  const update = { title: "작업", period: "", sources: [source()] };
  await expect(store.saveExperience(update, id, 1)).rejects.toThrow("100개");
  await store.saveExperience({ ...update, removedSourceIds: [sources[0].id] }, id, 1);
  expect(store.getSnapshot().experiences[0].sources).toHaveLength(100);
});

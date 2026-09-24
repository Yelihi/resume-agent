// @vitest-environment node
import { expect, it } from "vitest";
import { IndexedDbWorkspaceRepository } from "./IndexedDbWorkspaceRepository";
import { materialDraft, resumeInput, reviewRecord } from "../../test/fixtures";

const experience = (title: string) => ({ title, period: "2025", sources: [], markdown: `## 문제\n${title} 문제를 분석했다.`, metadata: `${title}: 운영 안정성 근거` });

it("automatically pins every finalized experience while excluding unfinished records and omitting candidates without a JD", async () => {
  const store = new IndexedDbWorkspaceRepository(`experience-auto-${crypto.randomUUID()}`);
  const contextId = await store.createContext("지원", resumeInput());
  const a = await store.saveExperience(experience("요청 개선"));
  const b = await store.saveExperience(experience("장애 분석"));
  const draftId = await store.saveExperience({ title: "미완성", period: "", sources: [{ id: "note", kind: "note", name: "메모", text: "정리 전", createdAt: new Date().toISOString() }] });
  expect((await store.prepareReview(contextId)).reviewContext.experiences).toEqual([]);
  await store.saveMaterial(materialDraft(), undefined, contextId);
  const input = await store.prepareReview(contextId);
  expect(input.reviewContext.selectedExperienceIds).toEqual([]);
  expect(input.reviewContext.experiences?.map(item => item.id).sort()).toEqual([a, b].sort());
  expect(input.reviewContext.experiences?.every(item => item.revision === 1 && item.markdown && item.metadata)).toBe(true);
  expect(input.reviewContext.experiences?.some(item => "sources" in item)).toBe(false);
  await expect(store.setContextExperiences(contextId, [draftId])).rejects.toThrow("본문과 메타데이터");
});

it("persists manual selection and restores pinned candidates and recommendations across source edits and retries", async () => {
  const name = `experience-pins-${crypto.randomUUID()}`;
  const store = new IndexedDbWorkspaceRepository(name);
  const contextId = await store.createContext("지원", resumeInput("검토 당시 이력서"));
  const materialId = await store.saveMaterial(materialDraft("기존 JD: 안정성"), undefined, contextId);
  const a = await store.saveExperience(experience("요청 개선"));
  const b = await store.saveExperience(experience("장애 분석"));
  await store.setContextExperiences(contextId, [a]);
  const input = await store.prepareReview(contextId);
  expect(input.reviewContext.selectedExperienceIds).toEqual([a]);
  expect(input.reviewContext.experiences).toHaveLength(2);
  const record = reviewRecord(input, []);
  record.response.status = "partial";
  record.response.errors = [{ moduleKey: "finalReview", inputSourceId: null, errorCode: "RETRYABLE", userMessage: "일부 확인 필요", canRetry: true }];
  record.moduleResults.finalReview.errors = record.response.errors;
  const recommendations = [
    { experienceId: a, decision: "include" as const, reason: "안정성 요구에 부합", jobEvidence: [{ sourceId: materialId, consideredPoint: "안정성" }], resumeBullets: ["요청 원인을 분석했다."], placement: "프로젝트 보강" },
    { experienceId: b, decision: "suggest" as const, reason: "장애 분석 경험도 추가할까요?", jobEvidence: [{ sourceId: materialId, consideredPoint: "안정성" }], resumeBullets: [], placement: "" },
  ];
  record.response.experienceRecommendations = recommendations;
  record.moduleResults.finalReview.output!.experienceRecommendations = recommendations;
  await store.registerRun(record.runId, input);
  await store.completeReview(record);
  expect(store.getSnapshot().reviews[0].experienceRecommendations).toEqual(recommendations);
  await store.saveExperience({ ...experience("바뀐 경험"), markdown: "현재의 다른 사실" }, a, 1);
  await store.saveMaterial(materialDraft("새 JD"), materialId, undefined, input.reviewContext.materialVersions![materialId]);
  await store.addResumeVersion(contextId, resumeInput("새 이력서"), input.reviewContext.resumeVersionId);
  await store.setContextExperiences(contextId, [b]);

  const reloaded = new IndexedDbWorkspaceRepository(name);
  expect((await reloaded.load()).contexts[0].selectedExperienceIds).toEqual([b]);
  for (const restored of [await reloaded.restoreRecord(record.runId), await reloaded.prepareRetry(record.runId)]) {
    expect(restored.reviewContext?.experiences).toEqual(input.reviewContext.experiences);
    expect(restored.reviewContext?.selectedExperienceIds).toEqual([a]);
    expect(restored.document).toEqual(input.document);
    expect(restored.materials).toEqual(input.materials);
    expect(restored.response.experienceRecommendations).toEqual(recommendations);
    expect(restored.moduleResults.finalReview.output?.experienceRecommendations).toEqual(recommendations);
    expect(restored.response.results).toEqual([]);
  }
  const next = await reloaded.prepareReview(contextId);
  expect(next.reviewContext.selectedExperienceIds).toEqual([b]);
  expect(next.reviewContext.experiences?.find(item => item.id === a)).toMatchObject({ revision: 2, markdown: "현재의 다른 사실" });
});

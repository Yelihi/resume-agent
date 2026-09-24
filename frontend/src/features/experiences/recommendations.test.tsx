import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "../../App";
import { IndexedDbWorkspaceRepository } from "../../infrastructure/workspace/IndexedDbWorkspaceRepository";
import { materialDraft, resumeInput, reviewRecord } from "../../test/fixtures";
import { createTestRouter } from "../../test/router";
import type { ExperienceRecommendation } from "../../domain/review/contracts";

it("shows selected include/omit decisions and writes an unselected experience only after approval using pinned inputs, retaining drafts on failed saves", async () => {
  const store = new IndexedDbWorkspaceRepository(`recommendations-ui-${crypto.randomUUID()}`);
  const contextId = await store.createContext("지원 검토", resumeInput("검토 당시의 이력서"));
  const materialId = await store.saveMaterial(materialDraft("JD 당시 운영 안정성 요건"), undefined, contextId);
  const ids: string[] = [];
  for (const title of ["요청 개선", "디자인 경험", "장애 분석"]) ids.push(await store.saveExperience({ title, period: "2025", sources: [], markdown: `${title} 당시의 구체적인 사실`, metadata: `${title}의 근거와 역량` }));
  await store.setContextExperiences(contextId, ids.slice(0, 2));
  const input = await store.prepareReview(contextId);
  const record = reviewRecord(input, []);
  const decisions = ["include", "omit", "suggest"] as const;
  const recommendations: ExperienceRecommendation[] = ids.map((experienceId, index) => ({ experienceId, decision: decisions[index],
    reason: ["요청 개선은 운영 안정성 요건을 충족합니다.", "디자인 경험은 이번 운영 요건과 관련이 부족합니다.", "장애 원인 분석도 운영 요건에 맞으므로 추가를 권합니다."][index],
    jobEvidence: [{ sourceId: materialId, consideredPoint: "운영 안정성 요건" }],
    resumeBullets: index === 0 ? ["중복 요청 원인을 분석하고 처리 방식을 개선했습니다."] : [], placement: index === 0 ? "프로젝트 보강" : "" }));
  record.response.experienceRecommendations = recommendations;
  record.moduleResults.finalReview.output!.experienceRecommendations = recommendations;
  await store.registerRun(record.runId, input);
  await store.completeReview(record);
  await store.saveExperience({ title: "현재의 경험 제목", period: "2026", sources: [], markdown: "현재의 다른 경험 사실", metadata: "현재의 다른 메타데이터" }, ids[2], 1);
  await store.saveMaterial(materialDraft("현재 JD의 다른 요건"), materialId, undefined, input.reviewContext.materialVersions![materialId]);
  await store.addResumeVersion(contextId, resumeInput("현재의 다른 이력서"), input.reviewContext.resumeVersionId);

  const generated = { markdown: "## 이력서용 요약\n\n- 장애 원인을 분석했습니다.\n\n## 상세 설명\n\n사실에 근거한 설명", summary: "- 장애 원인을 분석했습니다.", questions: [], sourceNotes: [] };
  const writeExperience = vi.fn().mockResolvedValue(generated);
  const user = userEvent.setup();
  render(<App router={createTestRouter([`/contexts/${contextId}`])} store={store} confirm={() => true} services={{
    writeExperience, getValidationPolicy: async () => ({ maximumFileSizeBytes: { pdf: 1000, image: 1000, docx: 1000, txt: 1000 }, maximumDirectTextCharacters: 100_000 }),
  }} />);
  const region = await screen.findByRole("region", { name: "JD 경험 추천" });
  expect(within(region).getByRole("article", { name: "요청 개선 추천" })).toHaveTextContent(recommendations[0].resumeBullets[0]);
  const omitted = within(region).getByRole("article", { name: "디자인 경험 추천" });
  expect(omitted).toHaveTextContent("이번 JD에서는 생략");
  expect(omitted).toHaveTextContent(recommendations[1].reason);
  expect(within(omitted).queryByRole("button")).not.toBeInTheDocument();
  const suggested = within(region).getByRole("article", { name: "장애 분석 추천" });
  expect(suggested).toHaveTextContent(recommendations[2].reason);
  expect(within(suggested).queryByRole("button", { name: "이력서 문구 복사" })).not.toBeInTheDocument();
  expect(writeExperience).not.toHaveBeenCalled();
  const tabs = screen.getByRole("navigation", { name: "작업 공간 화면" });
  expect(within(tabs).getAllByRole("link")).toHaveLength(1);
  expect(within(tabs).getByRole("link", { name: "이력서 검토" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "경험 남기기" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "경험 추가" })).not.toBeInTheDocument();

  await user.click(within(suggested).getByRole("button", { name: "이 경험도 추가하고 문구 작성" }));
  await within(suggested).findByRole("button", { name: "문구 저장" });
  expect(writeExperience).toHaveBeenCalledExactlyOnceWith({
    experience: { ...input.reviewContext.experiences!.find(item => item.id === ids[2]), sources: [] },
    resume: { id: input.reviewContext.resumeVersionId, text: "검토 당시의 이력서" },
    materials: [{ id: materialId, title: "채용 자료", materialType: "jobPosting", content: "JD 당시 운영 안정성 요건" }],
  });
  expect(store.getSnapshot().experienceDocuments).toEqual([]);
  expect(store.getSnapshot().contexts.find(item => item.id === contextId)?.selectedExperienceIds).toEqual(ids);
  await user.click(within(suggested).getByText("문구 편집 및 상세 설명"));
  const editor = within(suggested).getByRole("textbox", { name: "경험 문구 Markdown" });
  const edited = generated.markdown + "\n사용자가 보완한 근거";
  fireEvent.change(editor, { target: { value: edited } });
  vi.spyOn(store, "saveExperienceDocument").mockRejectedValueOnce(new Error("저장 공간 부족"));
  await user.click(within(suggested).getByRole("button", { name: "문구 저장" }));
  await screen.findByRole("dialog", { name: "요청 오류" });
  await user.click(screen.getByRole("button", { name: "오류 팝업 닫기" }));
  expect(editor).toHaveValue(edited);
  expect(store.getSnapshot().experienceDocuments).toEqual([]);
  await user.click(within(suggested).getByRole("button", { name: "문구 저장" }));
  await waitFor(() => expect(within(suggested).getByRole("status")).toHaveTextContent("문구 저장됨"));
  expect(store.getSnapshot().experienceDocuments[0]).toMatchObject({ id: `${record.runId}:${ids[2]}`, markdown: edited, input: writeExperience.mock.calls[0][0] });
  expect(store.getSnapshot().experiences.find(item => item.id === ids[2])?.markdown).toBe("현재의 다른 경험 사실");
  expect(store.getSnapshot().resumeVersions.find(item => item.id === input.reviewContext.resumeVersionId)?.document).toEqual(input.document);
  expect(writeExperience).toHaveBeenCalledTimes(1);
});

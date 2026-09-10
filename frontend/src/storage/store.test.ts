import { describe, expect, it } from "vitest";

import { ResumeAgentStore, emptyState } from "./store";

const flowDocument = {
  text: "새 이력서",
  blocks: [
    {
      blockId: "f-b1",
      lines: [{ lineId: "f-l1", text: "새 이력서", startOffset: 0, endOffset: 6 }],
    },
  ],
};

function store() {
  return new ResumeAgentStore(`test-${crypto.randomUUID()}`);
}

describe("ResumeAgentStore", () => {
  it("replacing a resume clears resume-derived state but keeps materials and last review", async () => {
    const db = store();
    await db.save({
      ...emptyState(),
      materials: [
        {
          sourceId: "company-1",
          materialType: "company",
          inputType: "text",
          status: "extracted",
          content: "회사 자료",
          displayName: "회사 자료",
        },
      ],
      lastReview: { results: [], userFeedback: "이전 의견" },
      currentReview: { status: "success", errors: [], materialReviews: [], results: [] },
      activeRunId: "old-run",
    });

    await db.beginResumeReplacement({
      inputType: "file",
      displayName: "new.txt",
      original: new Blob(["새 이력서"]),
    });
    const state = await db.load();

    expect(state.activeResume?.status).toBe("extracting");
    expect(state.currentReview).toBeUndefined();
    expect(state.activeRunId).toBeUndefined();
    expect(state.materials).toHaveLength(1);
    expect(state.lastReview?.userFeedback).toBe("이전 의견");
  });

  it("keeps the current resume original after extraction succeeds", async () => {
    const db = store();
    await db.beginResumeReplacement({
      inputType: "file",
      displayName: "resume.txt",
      original: new Blob(["새 이력서"]),
    });

    await db.completeResumeExtraction("flow", flowDocument);
    const resume = (await db.load()).activeResume;

    expect(resume?.status).toBe("ready");
    expect(resume?.original).toBeDefined();
    expect(resume?.document).toEqual(flowDocument);
  });

  it("deletes a material original after extraction but keeps derived content", async () => {
    const db = store();
    await db.addMaterial({
      sourceId: "job-1",
      materialType: "jobPosting",
      inputType: "document",
      status: "registered",
      displayName: "job.pdf",
      original: new Blob(["job"]),
    });

    await db.completeMaterialExtraction("job-1", "React 경력자를 찾습니다.");
    const item = (await db.load()).materials[0];

    expect(item.original).toBeUndefined();
    expect(item.status).toBe("extracted");
    expect(item.content).toBe("React 경력자를 찾습니다.");
  });

  it("explicit material deletion removes the whole record", async () => {
    const db = store();
    await db.addMaterial({
      sourceId: "company-1",
      materialType: "company",
      inputType: "text",
      status: "extracted",
      displayName: "회사 자료",
      content: "내용",
    });

    await db.deleteMaterial("company-1");

    expect((await db.load()).materials).toEqual([]);
  });
});


it("persists a JSON review record for offline results and retry, then clears it on replacement", async () => {
  const name = `record-${crypto.randomUUID()}`;
  const db = new ResumeAgentStore(name);
  const record = {
    runId: "saved-run", createdAt: "2026-09-10T00:00:00Z", document: flowDocument,
    materials: [],
    moduleResults: {
      spellCheck: { moduleKey: "spellCheck", output: [], errors: [] },
      finalReview: { moduleKey: "finalReview", output: { materialReviews: [], results: [] }, errors: [] },
    },
    response: { status: "success" as const, errors: [], materialReviews: [], results: [] },
  };
  await db.setActiveRun(record.runId);
  await db.completeReview(record);
  const reopened = new ResumeAgentStore(name);
  expect((await reopened.load()).reviewRecord).toEqual(record);
  expect((await reopened.load()).currentReview).toEqual(record.response);
  expect((await reopened.load()).activeRunId).toBeUndefined();
  await reopened.beginResumeReplacement({ inputType: "text", displayName: "new", original: "new" });
  expect((await reopened.load()).reviewRecord).toBeUndefined();
  expect((await reopened.load()).currentReview).toBeUndefined();
});

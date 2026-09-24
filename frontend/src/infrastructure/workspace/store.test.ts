import { expect, it } from "vitest";
import { IndexedDbWorkspaceRepository } from "./IndexedDbWorkspaceRepository";
import { resumeInput, reviewRecord, materialDraft } from "../../test/fixtures";

it("reopens normalized records and recreates a server retry payload with the original material versions", async () => {
  const name = `reopen-${crypto.randomUUID()}`;
  const db = new IndexedDbWorkspaceRepository(name);
  const context = await db.createContext("A", resumeInput());
  await db.saveMaterial(materialDraft(), undefined, context);
  const input = await db.prepareReview(context), record = reviewRecord(input);
  await db.registerRun(record.runId, input); await db.completeReview(record);
  const reopened = new IndexedDbWorkspaceRepository(name);
  const restored = await reopened.restoreRecord(record.runId);
  expect(restored.document).toEqual(record.document);
  expect(restored.materials).toEqual(record.materials);
  expect(restored.reviewContext).toEqual(record.reviewContext);
  expect(restored.response).toEqual(record.response);
});

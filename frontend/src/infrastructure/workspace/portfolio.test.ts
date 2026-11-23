// @vitest-environment node
import { expect, it } from "vitest";
import { IndexedDbWorkspaceRepository } from "./IndexedDbWorkspaceRepository";
import { resumeInput } from "../../test/fixtures";
import type { PortfolioReview } from "../../domain/review/portfolio";

it("restores portfolio attempts and citations by document version and removes them with the context", async () => {
  const name = `portfolio-${crypto.randomUUID()}`;
  const first = new IndexedDbWorkspaceRepository(name);
  const contextId = await first.createContext("지원", resumeInput("Search 40%"));
  const createdAt = "2026-11-23T00:00:00Z";
  for (const id of ["old", "new"]) {
    await first.savePortfolioVersion({ id, contextId, createdAt, pageCount: 1, name: id + ".pdf",
      original: new Blob([id], { type: "application/pdf" }) });
  }
  const resumeId = first.getSnapshot().contexts[0].latestVersionId;
  const result: PortfolioReview = { id: "review", contextId, portfolioVersionId: "old", pageNumber: 1, createdAt, policyVersion: "portfolio-1",
    text: "Search 20%", imageStatus: "failed", textStatus: "complete", findings: [], comparisonStatus: "complete",
    conflicts: [{ project: "Search", field: "metric",
      left: { kind: "portfolio", id: "old", version: "old", title: "old.pdf", quote: "Search 20%", value: "20%" },
      right: { kind: "resume", id: resumeId, version: "1", title: "이력서", quote: "Search 40%", value: "40%" } }] };
  await first.savePortfolioReview(result);
  await first.addResumeVersion(contextId, resumeInput("Search 50%"), resumeId);
  const reopened = new IndexedDbWorkspaceRepository(name);
  const snapshot = await reopened.load();
  expect(snapshot.portfolioReviews).toEqual([result]);
  expect(snapshot.portfolioVersions?.find(version => version.id === "old")?.original).toBeInstanceOf(Blob);
  await expect(reopened.savePortfolioReview({ ...result, id: "late-wrong", pageNumber: 2, conflicts: [] })).rejects.toThrow();
  await reopened.deleteContext(contextId);
  expect((await reopened.load()).portfolioReviews).toEqual([]);
  expect((await reopened.load()).portfolioVersions).toEqual([]);
  await expect(reopened.savePortfolioReview({ ...result, id: "late", conflicts: [] })).rejects.toThrow();
});

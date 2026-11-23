import { afterEach, expect, it, vi } from "vitest";
import { exportWorkspace, importWorkspace } from "./transfer";
import { IndexedDbWorkspaceRepository } from "./IndexedDbWorkspaceRepository";
import { resumeInput } from "../../test/fixtures";

afterEach(() => vi.unstubAllGlobals());

it("exports local originals and relationships, retries imports without reuploading, and never deletes local data", async () => {
  const store = new IndexedDbWorkspaceRepository(`transfer-${crypto.randomUUID()}`);
  const id = await store.createContext("이관 자료", resumeInput());
  const archive = await exportWorkspace(store);
  const text = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(archive); });
  const file = new File([text], "workspace.json");
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ imported: false })).mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json({ imported: true }));
  vi.stubGlobal("fetch", fetch);
  await importWorkspace(file);
  const payload = JSON.parse(fetch.mock.calls[1][1].body);
  expect(payload.workspace.contexts[0].id).toBe(id);
  expect(payload.workspace.resumeVersions[0].original).toBe(resumeInput().original);
  await importWorkspace(file);
  expect(fetch.mock.calls.filter(([path]) => path === "/api/workspace/import")).toHaveLength(1);
  expect((await store.load()).contexts[0].id).toBe(id);
});

it("includes the PDF original and saved page citations in a local archive import", async () => {
  const store = new IndexedDbWorkspaceRepository(`portfolio-export-${crypto.randomUUID()}`);
  const contextId = await store.createContext("검토", resumeInput("Search 40%"));
  const snapshot = store.getSnapshot();
  const createdAt = "2026-11-23T00:00:00Z";
  vi.spyOn(store, "load").mockResolvedValue({ ...snapshot,
    portfolioVersions: [{ id: "pdf", contextId, pageCount: 1, createdAt, name: "deck.pdf",
      original: new File(["%PDF-synthetic"], "deck.pdf", { type: "application/pdf" }) }],
    portfolioReviews: [{ id: "review", contextId, pageNumber: 1, portfolioVersionId: "pdf", createdAt,
      policyVersion: "portfolio-1", text: "Search 20%", textStatus: "complete", imageStatus: "failed", findings: [],
      comparisonStatus: "complete", conflicts: [{ project: "Search", field: "metric",
        left: { kind: "portfolio", id: "pdf", version: "pdf", title: "deck", value: "20%", quote: "Search 20%" },
        right: { kind: "resume", id: snapshot.contexts[0].latestVersionId, version: "1", title: "이력서", value: "40%", quote: "Search 40%" } }] }],
  });
  const archive = await exportWorkspace(store);
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(archive);
  });
  const file = new File([text], "workspace.json");
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ imported: false }))
    .mockResolvedValueOnce(Response.json({ fileId: "uploaded" })).mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal("fetch", fetch);
  await importWorkspace(file);
  expect(fetch.mock.calls[1][0]).toBe("/api/files");
  expect(fetch.mock.calls[1][1].body.get("file").name).toBe("deck.pdf");
  const { workspace } = JSON.parse(fetch.mock.calls[2][1].body);
  expect(workspace.portfolioVersions[0].original).toEqual({ fileId: "uploaded" });
  expect(workspace.portfolioReviews[0].conflicts[0].right).toMatchObject({ version: "1", quote: "Search 40%" });
});

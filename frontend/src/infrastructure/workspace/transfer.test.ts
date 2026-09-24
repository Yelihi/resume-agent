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

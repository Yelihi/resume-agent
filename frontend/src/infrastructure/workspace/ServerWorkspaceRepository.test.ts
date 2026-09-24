import { afterEach, expect, it, vi } from "vitest";
import { emptyWorkspace } from "../../domain/workspace/entities";
import { resumeInput } from "../../test/fixtures";
import { ServerWorkspaceRepository } from "./ServerWorkspaceRepository";

afterEach(() => vi.unstubAllGlobals());

it("uploads originals before committing, publishes only saved snapshots, and preserves state on conflicts", async () => {
  const store = new ServerWorkspaceRepository();
  const workspace = emptyWorkspace();
  const input = { ...resumeInput(), inputType: "file" as const, original: new File(["raw bytes"], "resume.txt") };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ workspace, revision: 0 }))
    .mockResolvedValueOnce(Response.json({ fileId: "file-1" }))
    .mockResolvedValueOnce(Response.json({ errors: [{ moduleKey: "workspace", inputSourceId: null, errorCode: "CONFLICT", userMessage: "변경됐습니다.", canRetry: false }] }, { status: 409 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await store.load();
  const before = store.getSnapshot();
  await expect(store.createContext("new", input)).rejects.toThrow("변경됐습니다.");
  expect(store.getSnapshot()).toBe(before);
  expect(fetch.mock.calls[1][1].body.get("file").name).toBe("resume.txt");
  expect(JSON.parse(fetch.mock.calls[2][1].body).args[1].original).toEqual({ fileId: "file-1" });
  expect(fetch.mock.calls[3][0]).toBe("/api/files/file-1");
  const saved = { ...workspace, resumeVersions: [{ ...input, original: { fileId: "file-2" }, id: "version", contextId: "context", status: "ready", version: 1, createdAt: "2026-09-24" }] };
  fetch.mockResolvedValueOnce(Response.json({ fileId: "file-2" })).mockResolvedValueOnce(Response.json({ workspace: saved, revision: 1, result: "context" }));
  await expect(store.createContext("new", input)).resolves.toBe("context");
  expect(store.getSnapshot().resumeVersions[0].original).toEqual({ fileId: "file-2", downloadUrl: "/api/files/file-2" });
  expect(fetch).toHaveBeenCalledTimes(6);
});

it("ignores a stale response arriving after a newer committed revision", async () => {
  const store = new ServerWorkspaceRepository();
  let resolve!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }))
    .mockResolvedValueOnce(Response.json({ workspace: { ...emptyWorkspace(), contexts: [{ id: "new", name: "최신" }] }, revision: 2 }));
  vi.stubGlobal("fetch", fetch);
  const old = store.load();
  await store.load();
  resolve(Response.json({ workspace: emptyWorkspace(), revision: 1 }));
  await old;
  expect(store.getSnapshot().contexts[0].id).toBe("new");
});

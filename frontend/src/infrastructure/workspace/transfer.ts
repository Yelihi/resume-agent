import { IndexedDbWorkspaceRepository } from "./IndexedDbWorkspaceRepository";
import { discardUploads, encodeFiles, type UploadedFile } from "./ServerWorkspaceRepository";
import { apiFetch } from "../http/client";

async function pack(value: unknown): Promise<unknown> {
  if (value instanceof Blob) return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ _type: "file", data: reader.result, name: value instanceof File ? value.name : "original" });
    reader.onerror = () => reject(new Error("원본 파일을 읽지 못했습니다."));
    reader.readAsDataURL(value);
  });
  if (Array.isArray(value)) return Promise.all(value.map(pack));
  if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await pack(item)])));
  return value;
}

function unpack(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === "object") {
    if ("fileId" in value || "downloadUrl" in value) throw new Error("이관 파일에는 원본 파일 내용이 필요합니다.");
    if ("_type" in value) {
      if (value._type !== "file" || !("data" in value) || typeof value.data !== "string" || !("name" in value) || typeof value.name !== "string") throw new Error("원본 파일 형식이 올바르지 않습니다.");
      const match = /^data:([^;,]*);base64,([A-Za-z0-9+/=]*)$/.exec(value.data);
      if (!match) throw new Error("원본 파일을 읽지 못했습니다.");
      const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
      return new File([bytes], value.name, { type: match[1] });
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
  }
  return value;
}

export async function exportWorkspace(store = new IndexedDbWorkspaceRepository()): Promise<Blob> {
  const workspace = await store.load();
  if (workspace.activeRun) throw new Error("진행 중인 검토를 완료한 뒤 내보내 주세요.");
  return new Blob([JSON.stringify({ kind: "resume-agent-workspace", version: 1, importId: crypto.randomUUID(), workspace: await pack(workspace) })], { type: "application/json" });
}

export async function importWorkspace(file: File): Promise<void> {
  // ponytail: bounded JSON archive for small personal workspaces; streaming archive when exports exceed 200 MiB.
  if (file.size > 200 * 1024 * 1024) throw new Error("이관 파일은 200MB 이하만 지원합니다.");
  const archive = JSON.parse(await file.text());
  if (archive?.kind !== "resume-agent-workspace" || archive.version !== 1 || typeof archive.importId !== "string" || !archive.workspace || typeof archive.workspace !== "object" || archive.workspace.activeRun) throw new Error("이관 파일 형식이 올바르지 않습니다.");
  const workspace = unpack(archive.workspace);
  const status = await apiFetch<{ imported: boolean }>(`/api/workspace/import/${encodeURIComponent(archive.importId)}`);
  if (status.imported) return;
  const files: UploadedFile[] = [];
  try {
    await apiFetch("/api/workspace/import", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ importId: archive.importId, workspace: await encodeFiles(workspace, "original", files) }),
    });
  } catch (error) { await discardUploads(files); throw error; }
}

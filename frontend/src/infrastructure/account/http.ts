import type { Account, BackupStatus } from "../../domain/shared/account";
import { apiFetch } from "../http/client";
import type { components } from "../http/schema";

export const getAccount = async (): Promise<Account> => {
  const account = await apiFetch<components["schemas"]["AccountResponse"]>("/api/account");
  if (account.mode !== "local" && account.mode !== "server") throw new Error("저장소 모드를 확인할 수 없습니다.");
  return { ...account, mode: account.mode };
};
export const getBackupStatus = (): Promise<BackupStatus> => apiFetch<components["schemas"]["BackupStatus"]>("/api/operations/backup");
export const saveOpenAiKey = async (apiKey: string) => { await apiFetch("/api/account/openai-key", {
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }),
}); };
export const deleteOpenAiKey = () => apiFetch<void>("/api/account/openai-key", { method: "DELETE" });

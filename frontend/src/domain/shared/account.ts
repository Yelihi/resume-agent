export type Account = { id: string; email: string; mode: "local" | "server"; hasOpenAiKey: boolean; maskedOpenAiKey: string | null; isOperator: boolean };
export type BackupStatus = { lastAttemptAt: string | null; lastSuccessAt: string | null; error: "BACKUP_NOT_RUN" | "BACKUP_STATUS_UNAVAILABLE" | "BACKUP_OR_RETENTION_FAILED" | null };
export interface AccountGateway {
  getAccount(): Promise<Account>;
  saveOpenAiKey(apiKey: string): Promise<void>;
  deleteOpenAiKey(): Promise<void>;
  getBackupStatus(): Promise<BackupStatus>;
  exportWorkspace(): Promise<Blob>;
  importWorkspace(file: File): Promise<void>;
}

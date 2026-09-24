export type Navigate = (path: string, afterSave?: boolean) => void;
export type WorkspaceRoute = { page: "list" | "new" | "context" | "upload" | "materials" | "experiences" | "writing" | "settings" | "notFound"; contextId?: string };

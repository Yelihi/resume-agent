import { apiFetch } from "../http/client";

export const previewMaterial = (materialType: "company" | "jobPosting", content: string) =>
  apiFetch<{ content: string; sources: string[] }>("/api/materials/preview", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ materialType, content }),
  });

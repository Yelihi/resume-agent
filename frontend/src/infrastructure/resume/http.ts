import { apiFetch } from "../http/client";
import type { components } from "../http/schema";

import type { FileKind, ValidationPolicy } from "../../domain/resume/ports";
import type { PageDocument, FlowDocument } from "../../domain/resume/contracts";

export const getValidationPolicy = () =>
  apiFetch<ValidationPolicy>("/api/resumes/validation-policy");

export async function extractText(text: string): Promise<FlowDocument> {
  const response = await apiFetch<components["schemas"]["ExtractFlowDocumentResponse"]>(
    "/api/resumes/extract/text",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  return response.document;
}

export async function extractFile(
  file: File,
  kind: FileKind,
): Promise<{ kind: "page"; document: PageDocument } | { kind: "flow"; document: FlowDocument }> {
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch<{ document: PageDocument | FlowDocument }>(
    `/api/resumes/extract/${kind}`,
    { method: "POST", body: form },
  );
  return kind === "pdf" || kind === "image"
    ? { kind: "page", document: response.document as PageDocument }
    : { kind: "flow", document: response.document as FlowDocument };
}

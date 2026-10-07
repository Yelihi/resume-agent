import type { ExperienceGateway, MetadataResult, WritingResult } from "../../domain/experience/entities";
import { apiFetch, apiResponse } from "../http/client";

export const writeExperience: ExperienceGateway["writeExperience"] = input => apiFetch<WritingResult>("/api/experiences/write", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
});

async function generate<T>(path: string, input: unknown, valid: (value: unknown) => value is T,
  onProgress?: (message: string) => void, signal?: AbortSignal): Promise<T> {
  const response = await apiResponse(path, {
    method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(input), signal,
  });
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
    throw new Error("진행 상태 응답을 확인할 수 없습니다.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("생성 중 연결이 끊겼습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요.");
      buffer += decoder.decode(value, { stream: true });
      // This endpoint emits one JSON data line per SSE event; comments are heartbeats.
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        let event: unknown;
        try { event = JSON.parse(data); } catch { throw new Error("진행 상태 응답을 확인할 수 없습니다."); }
        if (!event || typeof event !== "object" || !("type" in event)) throw new Error("진행 상태 응답을 확인할 수 없습니다.");
        if (event.type === "completed" && "result" in event && valid(event.result)) return event.result;
        if ((event.type === "progress" || event.type === "failed") && "message" in event && typeof event.message === "string") {
          if (event.type === "failed") throw new Error(event.message);
          onProgress?.(event.message);
        } else throw new Error("생성 결과를 확인할 수 없습니다. 작성 내용은 유지됩니다.");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function isWritingResult(value: unknown): value is WritingResult {
  if (!value || typeof value !== "object") return false;
  return "markdown" in value && typeof value.markdown === "string" && !!value.markdown.trim() && value.markdown.length <= 60_000
    && "summary" in value && typeof value.summary === "string"
    && "questions" in value && Array.isArray(value.questions) && value.questions.every(item => typeof item === "string")
    && "sourceNotes" in value && Array.isArray(value.sourceNotes) && value.sourceNotes.every(note =>
      note && typeof note.sourceId === "string" && typeof note.text === "string" && typeof note.verified === "boolean");
}

export const draftExperience: ExperienceGateway["draftExperience"] = (input, onProgress, signal) =>
  generate("/api/experiences/draft", input, isWritingResult, onProgress, signal);
export const experienceMetadata: ExperienceGateway["experienceMetadata"] = (input, onProgress, signal) =>
  generate("/api/experiences/metadata", input, (value): value is MetadataResult =>
    !!value && typeof value === "object" && "metadata" in value && typeof value.metadata === "string"
    && !!value.metadata.trim() && value.metadata.length <= 12_000
    && (!("talkingPoints" in value) || (typeof value.talkingPoints === "string" && value.talkingPoints.length <= 8000))
    && (!("interviewQuestions" in value) || (Array.isArray(value.interviewQuestions) && value.interviewQuestions.length <= 20
      && value.interviewQuestions.every(item => item && typeof item.question === "string" && !!item.question.trim() && item.question.length <= 500
        && typeof item.answer === "string" && item.answer.length <= 4000 && typeof item.evidence === "string" && item.evidence.length <= 2000))), onProgress, signal);

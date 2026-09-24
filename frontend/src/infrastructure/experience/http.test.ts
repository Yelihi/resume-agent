import { afterEach, expect, it, vi } from "vitest";
import { draftExperience, experienceMetadata } from "./http";

afterEach(() => vi.unstubAllGlobals());
const input = { title: "경험", period: "", markdown: "원본 본문", sources: [] };
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    // Split every UTF-8 character and event delimiter across network chunks.
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}

it("reads split Korean progress and the terminal result for both generation requests", async () => {
  const draft = { markdown: "## 초안", summary: "요약", questions: [], sourceNotes: [] };
  const fetch = vi.fn()
    .mockResolvedValueOnce(response(': keep-alive\r\n\r\ndata: {"type":"progress","message":"자료 확인 중"}\r\n\r\ndata: '+JSON.stringify({ type: "completed", result: draft })+'\r\n\r\n'))
    .mockResolvedValueOnce(response('data: {"type":"completed","result":{"metadata":"문제와 해결"}}\n\n'));
  vi.stubGlobal("fetch", fetch);
  const progress = vi.fn();
  const controller = new AbortController();
  await expect(draftExperience(input, progress, controller.signal)).resolves.toEqual(draft);
  expect(progress).toHaveBeenCalledWith("자료 확인 중");
  expect(fetch).toHaveBeenCalledWith("/api/experiences/draft", expect.objectContaining({ signal: controller.signal, headers: expect.objectContaining({ accept: "text/event-stream" }) }));
  await expect(experienceMetadata(input)).resolves.toEqual({ metadata: "문제와 해결" });
});

it("rejects interrupted, failed and malformed streams instead of accepting a partial result", async () => {
  for (const stream of [
    'data: {"type":"progress","message":"작성 중"}\n\n',
    'data: {"type":"failed","message":"생성 실패"}\n\n',
    'data: not-json\n\n',
    'data: {"type":"completed","result":{"markdown":""}}\n\n',
    'data: {"type":"completed","result":{"metadata":" "}}\n\n',
  ]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(stream)));
    await expect(experienceMetadata(input)).rejects.toBeInstanceOf(Error);
  }
});

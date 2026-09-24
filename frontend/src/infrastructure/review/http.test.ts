import { afterEach, expect, it, vi } from "vitest";
import { followReview } from "./http";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(public url: string) { super(); FakeEventSource.instances.push(this); }
}
function setup() {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  return () => FakeEventSource.instances[0];
}
afterEach(() => vi.unstubAllGlobals());

it("closes an aborted stream without forwarding queued progress", async () => {
  const source = setup();
  const controller = new AbortController();
  const progress = vi.fn();
  const stream = followReview("run", progress, controller.signal);
  controller.abort();
  await expect(stream).rejects.toMatchObject({ name: "AbortError" });
  expect(source().close).toHaveBeenCalledOnce();
  source().dispatchEvent(new MessageEvent("completed", { data: JSON.stringify({ message: "late completion" }) }));
  expect(progress).not.toHaveBeenCalled();
});

it("does not open a stream if the subscription is already aborted", async () => {
  setup();
  await expect(followReview("run", vi.fn(), AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeEventSource.instances).toEqual([]);
});

it.each(["not JSON", "{}", '{"message": 42}'])("rejects malformed stream data and closes the connection: %s", async data => {
  const source = setup();
  const progress = vi.fn();
  const stream = followReview("run", progress);
  source().dispatchEvent(new MessageEvent("spellCheck", { data }));
  await expect(stream).rejects.toBeInstanceOf(Error);
  expect(source().close).toHaveBeenCalledOnce();
  expect(progress).not.toHaveBeenCalled();
});

it("releases its abort listener after terminal completion", async () => {
  const source = setup();
  const controller = new AbortController();
  const removed = vi.spyOn(controller.signal, "removeEventListener");
  const progress = vi.fn();
  const stream = followReview("run", progress, controller.signal);
  source().dispatchEvent(new MessageEvent("completed", { data: JSON.stringify({ message: "Done" }) }));
  await stream;
  expect(progress).toHaveBeenCalledWith({ event: "completed", message: "Done" });
  expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  controller.abort();
  expect(source().close).toHaveBeenCalledOnce();
});

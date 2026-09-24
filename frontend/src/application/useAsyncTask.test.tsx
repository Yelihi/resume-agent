import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAsyncTask } from "./useAsyncTask";

it("rejects overlapping work synchronously and releases the guard after completion", async () => {
  const { result } = renderHook(useAsyncTask);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const first = vi.fn(() => pending);
  const duplicate = vi.fn(async () => {});
  let task!: Promise<void>;
  act(() => { task = result.current.runTask(first, "실패"); void result.current.runTask(duplicate, "실패"); });
  expect(result.current.busy).toBe(true);
  expect(first).toHaveBeenCalledOnce();
  expect(duplicate).not.toHaveBeenCalled();
  await act(async () => { finish(); await task; });
  expect(result.current.busy).toBe(false);
  await act(() => result.current.runTask(duplicate, "실패"));
  expect(duplicate).toHaveBeenCalledOnce();
});

it("reports failures, clears old errors when retrying, and unlocks after rejection", async () => {
  const { result } = renderHook(useAsyncTask);
  await act(() => result.current.runTask(async () => { throw new Error("저장 실패"); }, "실패"));
  expect(result.current.error?.message).toBe("저장 실패");
  expect(result.current.busy).toBe(false);
  let finish!: () => void;
  let task!: Promise<void>;
  act(() => { task = result.current.runTask(() => new Promise(resolve => { finish = resolve; }), "실패"); });
  expect(result.current.error).toBeNull();
  await act(async () => { finish(); await task; });
  expect(result.current.busy).toBe(false);
  act(() => result.current.reportError(new Error("별도 오류"), "실패"));
  expect(result.current.error).not.toBeNull();
  act(() => result.current.clearError());
  expect(result.current.error).toBeNull();
});

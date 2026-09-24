import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ResumePreview } from "./ResumePreview";
import { IndexedDbWorkspaceRepository } from "../../infrastructure/workspace/IndexedDbWorkspaceRepository";
import { resumeInput } from "../../test/fixtures";
import { ResumeViewer } from "../../viewer/ResumeViewer";

vi.mock("../../viewer/ResumeViewer", () => ({ ResumeViewer: vi.fn(() => <div>원문 내용</div>) }));

it("does not rebuild document content for progress props or unrelated store feedback", async () => {
  const store = new IndexedDbWorkspaceRepository(`preview-${crypto.randomUUID()}`);
  const contextId = await store.createContext("지원", resumeInput());
  const resume = store.getSnapshot().resumeVersions[0];
  const selectedLineIds: string[] = [];
  const { rerender } = render(<><p>검토 시작</p><ResumePreview store={store} resumeVersionId={resume.id} selectedLineIds={selectedLineIds} /></>);
  const reads = vi.mocked(ResumeViewer).mock.calls.length;
  expect(reads).toBeGreaterThan(0);
  rerender(<><p>검토 진행 중</p><ResumePreview store={store} resumeVersionId={resume.id} selectedLineIds={selectedLineIds} /></>);
  expect(ResumeViewer).toHaveBeenCalledTimes(reads);
  await act(() => store.saveReviewFeedback(contextId, "간결하게"));
  expect(ResumeViewer).toHaveBeenCalledTimes(reads);
  expect(screen.getByText("원문 내용")).toBeInTheDocument();
  rerender(<ResumePreview store={store} resumeVersionId="missing" selectedLineIds={selectedLineIds} />);
  expect(screen.getByText("원문을 확인할 수 없는 이전 검토입니다.")).toBeInTheDocument();
});

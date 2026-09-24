import { useDraftState } from "./useDraftState";
import { classifyFile, validateFileSize, validateTextLength } from "../domain/resume/policies";
import type { ValidationPolicy } from "../domain/resume/ports";
import type { Context } from "../domain/context/entities";
import type { ResumeInput } from "../domain/resume/entities";
import type { WorkspaceRepository } from "../domain/workspace/ports";
import type { ApplicationServices } from "../domain/workspace/services";
import type { RunTask } from "./useAsyncTask";

export type ResumeDraft = { inputMode: "file" | "text"; text: string; file?: File; contextName: string };
const emptyDraft: ResumeDraft = { inputMode: "file", text: "", contextName: "" };

export function useResumeWorkflow({ store, services, resolvePolicy, runTask, onSaved }: {
  store: Pick<WorkspaceRepository, "createContext" | "addResumeVersion">; services: Pick<ApplicationServices, "extractText" | "extractFile">; resolvePolicy: () => Promise<ValidationPolicy>;
  runTask: RunTask; onSaved: (contextId: string) => void;
}) {
  const [draft, setDraft, ownsDraft] = useDraftState<ResumeDraft>(emptyDraft);
  const [pendingResume, setPendingResume, ownsPendingResume] = useDraftState<ResumeInput | null>(null);
  const updateDraft = (change: Partial<ResumeDraft>) => setDraft(current => ({ ...current, ...change }));
  async function persist(input: ResumeInput, context?: Context, ownsInput = () => ownsDraft(draft)) {
    if (!ownsInput()) return;
    const contextId = context?.id ?? await store.createContext(draft.contextName, input);
    if (context) await store.addResumeVersion(context.id, input, context.latestVersionId);
    if (ownsInput()) { setPendingResume(null); onSaved(contextId); }
  }
  const saveResume = (context?: Context) => runTask(async () => {
    const policy = await resolvePolicy();
    if (!ownsDraft(draft)) return;
    let input: ResumeInput;
    if (draft.inputMode === "text") {
      validateTextLength(draft.text, policy);
      input = { inputType: "text", displayName: "직접 입력 이력서", original: draft.text, documentKind: "flow", document: await services.extractText(draft.text) };
    } else {
      if (!draft.file) throw new Error("이력서 파일을 선택해 주세요.");
      const kind = classifyFile(draft.file);
      validateFileSize(draft.file, kind, policy);
      const extracted = await services.extractFile(draft.file, kind);
      input = { inputType: "file", displayName: draft.file.name, original: draft.file, documentKind: extracted.kind, document: extracted.document };
    }
    if (!ownsDraft(draft)) return;
    if (input.document.extraction?.status === "needs_review") setPendingResume(input);
    else await persist(input, context);
  }, "이력서를 저장하지 못했습니다.");
  const confirmExtraction = (context?: Context) => runTask(async () => {
    if (!pendingResume) return;
    await persist({ ...pendingResume, document: { ...pendingResume.document, extraction: { ...pendingResume.document.extraction!, confirmed: true } } }, context, () => ownsPendingResume(pendingResume) && ownsDraft(draft));
  }, "이력서를 저장하지 못했습니다.");
  const reset = () => { setDraft(emptyDraft); setPendingResume(null); };
  return { draft, updateDraft, pendingResume, saveResume, confirmExtraction, cancelExtraction: () => setPendingResume(null), reset,
    dirty: !!draft.text || !!draft.file || !!draft.contextName || !!pendingResume };
}

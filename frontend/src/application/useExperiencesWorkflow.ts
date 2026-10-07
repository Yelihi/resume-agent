import { useEffect, useRef, useState } from "react";
import type { Experience, ExperienceDocument, ExperienceSource, InterviewQuestion, WritingInput } from "../domain/experience/entities";
import type { Review } from "../domain/review/entities";
import type { Workspace } from "../domain/workspace/entities";
import type { WorkspaceRepository } from "../domain/workspace/ports";
import type { ApplicationServices, ConfirmAction } from "../domain/workspace/services";
import { classifyFile, documentText, validateFileSize } from "../domain/resume/policies";
import type { RunTask } from "./useAsyncTask";
import { useDraftState } from "./useDraftState";

export type ExperienceEditor = {
  experienceId?: string; baseRevision?: number; title: string; period: string;
  markdown: string; links: string; files: File[]; sources: ExperienceSource[];
  metadata: string; metadataFor: string; questions: string[];
  talkingPoints: string; interviewQuestions: InterviewQuestion[];
  sourceNotes: ExperienceDocument["sourceNotes"]; preview: boolean; useTemplate: boolean;
};
export type WritingDraft = Omit<ExperienceDocument, "createdAt" | "updatedAt" | "revision"> & { baseRevision?: number };

export function useExperiencesWorkflow({ store, workspace, services, runTask, confirm }: {
  store: WorkspaceRepository; workspace: Workspace; services: ApplicationServices; runTask: RunTask; confirm: ConfirmAction;
}) {
  const [editor, setEditor, ownsEditor] = useDraftState<ExperienceEditor | null>(null);
  const [generation, setGeneration] = useState<{ kind: "draft" | "metadata"; message: string } | null>(null);
  const generationAbort = useRef<AbortController | null>(null);
  useEffect(() => () => generationAbort.current?.abort(), []);
  const [writingDraft, setWritingDraft] = useState<WritingDraft | null>(null);
  const [selectedExperienceId, setSelectedExperienceId] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const discardWriting = () => !writingDraft || confirm("저장하지 않은 작성 내용을 버릴까요?");
  const openEditor = (experience?: Experience) => {
    const markdown = experience?.markdown ?? experience?.sources.filter(source => source.kind === "note").map(source => source.text).join("\n\n") ?? "";
    setEditor({ experienceId: experience?.id, baseRevision: experience?.revision, title: experience?.title ?? "", period: experience?.period ?? "",
      markdown, links: "", files: [], sources: experience?.sources ?? [], metadata: experience?.metadata ?? "",
      talkingPoints: experience?.talkingPoints ?? "", interviewQuestions: experience?.interviewQuestions ?? [],
      metadataFor: experience?.metadata ? markdown : "", questions: [], sourceNotes: [], preview: false, useTemplate: true });
  };
  const cancelEditor = () => { if (confirm("저장하지 않은 경험 기록을 버릴까요?")) setEditor(null); };
  const updateEditor = (change: Partial<ExperienceEditor>) => setEditor(current => current ? {
    ...current, ...change,
    ...(["markdown", "title", "period", "links", "files"].some(key => key in change) ? { metadataFor: "" } : {}),
  } : current);
  const removeSource = (id: string) => setEditor(current => current ? {
    ...current, sources: current.sources.filter(source => source.id !== id),
    sourceNotes: current.sourceNotes.filter(note => note.sourceId !== id),
  } : current);
  async function collectSources(draft: ExperienceEditor, onProgress?: (message: string) => void): Promise<ExperienceSource[]> {
    const sources = [...draft.sources];
    const makeSource = (kind: ExperienceSource["kind"], name: string, text: string): ExperienceSource => ({ id: crypto.randomUUID(), kind, name, text, createdAt: new Date().toISOString() });
    for (const value of draft.links.split("\n").map(line => line.trim()).filter(Boolean)) {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error("링크를 한 줄에 하나씩 입력해 주세요."); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("http 또는 https 링크를 입력해 주세요.");
      if (!sources.some(source => source.url === value)) sources.push({ ...makeSource("link", value, ""), url: value });
    }
    for (const file of draft.files) {
      onProgress?.(`${file.name} 내용을 읽고 있습니다.`);
      if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|tiff?|webp|svg|avif|bmp|ico|heic)$/i.test(file.name)) throw new Error("이미지는 외부 URL을 Markdown에 입력해 주세요. 직접 이미지 첨부는 지원하지 않습니다.");
      let text: string;
      if (/\.(pdf|docx)$/i.test(file.name)) {
        const kind = classifyFile(file);
        validateFileSize(file, kind, await services.getValidationPolicy());
        text = documentText((await services.extractFile(file, kind)).document);
      } else {
        if (file.size > 2 * 1024 * 1024) throw new Error("텍스트·코드 파일은 2MB 이하로 첨부해 주세요.");
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
        catch { throw new Error(`${file.name}: 텍스트를 읽을 수 없습니다. 압축 파일은 풀어서 필요한 파일을 선택해 주세요.`); }
        if (text.includes("\0")) throw new Error(`${file.name}: 텍스트·코드 파일 또는 PDF·DOCX를 선택해 주세요.`);
      }
      if (!text.trim() || text.length > 100_000) throw new Error(`${file.name}: 내용을 확인하거나 파일을 나누어 첨부해 주세요.`);
      sources.push({ ...makeSource("file", file.name, text), original: file });
    }
    if (sources.length > 100) throw new Error("한 경험에는 원본을 100개까지 보관할 수 있습니다. 경험을 나누어 기록해 주세요.");
    return sources;
  }
  const transformExperience = () => runTask(async () => {
    if (!editor) return;
    const controller = new AbortController();
    generationAbort.current = controller;
    const progress = (message: string) => { if (ownsEditor(editor)) setGeneration({ kind: "draft", message }); };
    progress("첨부 자료를 준비하고 있습니다.");
    try {
      const sources = await collectSources(editor, progress);
      if (!ownsEditor(editor)) return;
      const input = { title: editor.title, period: editor.period, markdown: editor.markdown, useTemplate: editor.useTemplate,
        sources: sources.map(({ original: _original, ...source }) => source) };
      const result = await services.draftExperience(input, progress, controller.signal);
      if (ownsEditor(editor)) setEditor({ ...editor, sources, files: [], links: "", markdown: result.markdown,
        questions: result.questions, sourceNotes: result.sourceNotes, metadataFor: "", preview: false });
    } finally {
      generationAbort.current = null;
      setGeneration(null);
    }
  }, "경험 초안을 작성하지 못했습니다. 입력과 첨부 자료는 유지됩니다.");
  const generateMetadata = () => runTask(async () => {
    if (!editor?.markdown.trim()) throw new Error("경험 본문을 작성해 주세요.");
    const controller = new AbortController();
    generationAbort.current = controller;
    const progress = (message: string) => { if (ownsEditor(editor)) setGeneration({ kind: "metadata", message }); };
    progress("메타데이터 생성을 위해 본문을 준비하고 있습니다.");
    try {
      const sources = await collectSources(editor, progress);
      if (!ownsEditor(editor)) return;
      const result = await services.experienceMetadata({ title: editor.title, period: editor.period, markdown: editor.markdown }, progress, controller.signal);
      if (ownsEditor(editor)) setEditor({ ...editor, sources, files: [], links: "", metadata: result.metadata, metadataFor: editor.markdown,
        talkingPoints: editor.talkingPoints.trim() ? editor.talkingPoints : result.talkingPoints ?? "",
        interviewQuestions: editor.interviewQuestions.length ? editor.interviewQuestions : result.interviewQuestions ?? [],
      });
    } finally {
      generationAbort.current = null;
      setGeneration(null);
    }
  }, "메타데이터를 생성하지 못했습니다. 작성 내용은 유지됩니다.");
  const saveExperience = () => runTask(async () => {
    if (!editor) return;
    if (!editor.markdown.trim() || !editor.metadata.trim() || editor.metadataFor !== editor.markdown) throw new Error("최신 본문의 메타데이터를 생성해 주세요.");
    if (editor.interviewQuestions.some(item => !item.question.trim())) throw new Error("예상 질문을 입력하거나 빈 항목을 삭제해 주세요.");
    const existing = workspace.experiences.find(item => item.id === editor.experienceId);
    const sources = editor.sources.filter(source => !existing?.sources.some(saved => saved.id === source.id));
    const removedSourceIds = existing?.sources.filter(saved => !editor.sources.some(source => source.id === saved.id)).map(source => source.id) ?? [];
    const id = await store.saveExperience({ title: editor.title, period: editor.period, sources, removedSourceIds,
      markdown: editor.markdown, metadata: editor.metadata, talkingPoints: editor.talkingPoints,
      interviewQuestions: editor.interviewQuestions }, editor.experienceId, editor.baseRevision);
    if (ownsEditor(editor)) { setSelectedExperienceId(id); setEditor(null); }
  }, "경험 기록을 저장하지 못했습니다. 입력은 유지됩니다.");
  const selectDocument = (id: string) => {
    if (id === selectedDocumentId || !discardWriting()) return;
    setWritingDraft(null); setSelectedDocumentId(id);
  };
  const editDocument = (document: ExperienceDocument, markdown: string) => {
    setWritingDraft({ ...document, baseRevision: document.revision, markdown });
  };
  const approveRecommendation = (review: Review, experienceId: string) => {
    if (!discardWriting()) return;
    return runTask(async () => {
      const recommendation = review.experienceRecommendations?.find(item => item.experienceId === experienceId && item.decision === "suggest");
      const experience = review.input.experiences?.find(item => item.id === experienceId);
      const resume = workspace.resumeVersions.find(item => item.id === review.resumeVersionId);
      if (!recommendation || !experience || !resume?.document) throw new Error("추천에 사용한 경험과 이력서를 찾을 수 없습니다.");
      const input: WritingInput = {
        experience: { ...experience, sources: [] },
        resume: { id: resume.id, text: documentText(resume.document) },
        materials: Object.entries(review.input.materialVersions ?? {}).map(([materialId, versionId]) => {
          const version = workspace.materialVersions.find(item => item.id === versionId && item.materialId === materialId);
          if (!version || version.legacyUrl) throw new Error("추천에 사용한 JD 원문을 확인해 주세요.");
          return { id: materialId, title: version.title, content: version.content, materialType: version.materialType };
        }),
      };
      const context = workspace.contexts.find(item => item.id === review.contextId);
      if (!context) throw new Error("작업 공간을 찾을 수 없습니다.");
      await store.setContextExperiences(context.id, [...(context.selectedExperienceIds ?? []), experienceId]);
      const result = await services.writeExperience(input);
      const id = `${review.id}:${experienceId}`;
      const old = workspace.experienceDocuments.find(item => item.id === id);
      setWritingDraft({ ...result, id, contextId: review.contextId, experienceId, input, baseRevision: old?.revision });
    }, "추천 경험의 문구를 작성하지 못했습니다. 다시 시도해 주세요.");
  };
  const saveWriting = () => runTask(async () => {
    if (!writingDraft) return;
    const { baseRevision, ...document } = writingDraft;
    await store.saveExperienceDocument(document, baseRevision);
    setWritingDraft(null);
  }, "작성본을 저장하지 못했습니다. 작성 내용은 유지됩니다.");
  const removeDocument = (document: ExperienceDocument) => {
    if (!confirm("이 작업 공간의 작성본을 삭제할까요? 경험 원본은 유지됩니다.")) return;
    return runTask(async () => { await store.deleteExperienceDocument(document.id); setWritingDraft(null); setSelectedDocumentId(""); }, "작성본을 삭제하지 못했습니다.");
  };
  return { editor, generation, openEditor, cancelEditor, saveExperience,
    updateEditor, removeSource, transformExperience, generateMetadata,
    selectedExperienceId, selectExperience: setSelectedExperienceId, selectedDocumentId, selectDocument,
    writingDraft, editDocument, updateWriting: (markdown: string) => setWritingDraft(current => current ? { ...current, markdown } : current),
    discardWriting: () => { if (discardWriting()) setWritingDraft(null); },
    approveRecommendation, saveWriting, removeDocument,
    dirty: !!editor || !!writingDraft,
    reset: () => { setEditor(null); setWritingDraft(null); setSelectedExperienceId(""); setSelectedDocumentId(""); },
  };
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  CheckCircle,
  FileText,
  FolderOpen,
  Gear,
  Paperclip,
  Play,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

import {
  classifyFile,
  extractFile,
  extractText,
  getValidationPolicy,
  validateFileSize,
  validateTextLength,
  type ValidationPolicy,
} from "./api/resume";
import {
  cancelReview,
  followReview,
  getReviewRecord,
  releaseReview,
  retryReview,
  startReview,
  type ProgressEvent,
  type ReferenceMaterial,
  type RetryModule,
} from "./api/review";
import { toApplicationApiError, type ApplicationApiError } from "./api/client";
import { ErrorPopup } from "./components/ErrorPopup";
import {
  ResumeAgentStore,
  emptyState,
  type AppState,
  type MaterialRecord,
} from "./storage/store";
import { ResumeViewer } from "./viewer/ResumeViewer";

type InputServices = {
  getValidationPolicy: typeof getValidationPolicy;
  extractText: typeof extractText;
  extractFile: typeof extractFile;
  startReview: typeof startReview;
  followReview: typeof followReview;
  getReviewRecord: typeof getReviewRecord;
  releaseReview: typeof releaseReview;
  cancelReview: typeof cancelReview;
  retryReview: typeof retryReview;
};

const defaultServices: InputServices = {
  getValidationPolicy,
  extractText,
  extractFile,
  startReview,
  followReview,
  getReviewRecord,
  releaseReview,
  cancelReview,
  retryReview,
};
const defaultStore = new ResumeAgentStore();

type AppProps = {
  store?: ResumeAgentStore;
  services?: Partial<InputServices>;
};

export function App({ store = defaultStore, services: overrides }: AppProps) {
  const services = useMemo(() => ({ ...defaultServices, ...overrides }), [overrides]);
  const [state, setState] = useState<AppState>(emptyState());
  const [policy, setPolicy] = useState<ValidationPolicy>();
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [resumeText, setResumeText] = useState("");
  const [companyText, setCompanyText] = useState("");
  const [jobText, setJobText] = useState("");
  const [error, setError] = useState<ApplicationApiError | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [progressDelayed, setProgressDelayed] = useState(false);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [selectedSuggestionNumber, setSelectedSuggestionNumber] = useState<number>();
  const [feedback, setFeedback] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [materialTab, setMaterialTab] = useState<"jobPosting" | "company">("jobPosting");
  const reconnecting = useRef(false);
  const materialsTrigger = useRef<HTMLButtonElement>(null);
  const drawerPanel = useRef<HTMLElement>(null);
  const viewerPanel = useRef<HTMLElement>(null);

  const refresh = async () => setState(await store.load());

  async function resolvePolicy() {
    if (policy) return policy;
    const loaded = await services.getValidationPolicy();
    setPolicy(loaded);
    return loaded;
  }

  useEffect(() => {
    store.load()
      .then((saved) => {
        setState(saved);
        setFeedback(saved.lastReview?.userFeedback ?? "");
        if (saved.activeRunId && !reconnecting.current) {
          reconnecting.current = true;
          void finishRun(saved.activeRunId);
        }
      })
      .catch((caught) => setError(toApplicationApiError(caught, "저장된 검토를 불러오지 못했습니다.")));
    services.getValidationPolicy()
      .then(setPolicy)
      .catch((caught) => setError(toApplicationApiError(caught, "입력 정책을 불러오지 못했습니다. 새로고침해 주세요.")));
  }, [services, store]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerPanel.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      materialsTrigger.current?.focus();
    };
  }, [drawerOpen]);

  useEffect(() => {
    const selectedId = selectedLineIds[0];
    if (!selectedId) return;
    const target = Array.from(
      viewerPanel.current?.querySelectorAll<HTMLElement>("[data-line-id]") ?? [],
    ).find((element) => element.dataset.lineId === selectedId);
    target?.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [selectedLineIds]);

  useEffect(() => {
    setProgressDelayed(false);
    if (!running || !progress) return;
    const timer = window.setTimeout(() => setProgressDelayed(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [progress, running]);

  async function finishRun(runId: string) {
    setRunning(true);
    let terminal = "";
    try {
      await services.followReview(runId, (event: ProgressEvent) => {
        terminal = event.event;
        setProgress(event.message);
      });
      if (terminal === "cancelled") {
        await store.clearActiveRun();
      } else {
        await store.completeReview(await services.getReviewRecord(runId));
      }
      await refresh();
      // Release only after IndexedDB commits; a failed cleanup must not lose the saved result.
      await services.releaseReview(runId).catch((caught) => console.warn("Review cleanup failed", caught));
    } catch (caught) {
      setError(toApplicationApiError(caught, "검토 상태를 확인하지 못했습니다. 새로고침해 다시 연결해 주세요."));
      await refresh();
    } finally {
      setRunning(false);
      setProgress("");
    }
  }

  async function beginReview() {
    const saved = await store.load();
    const resume = saved.activeResume;
    if (!resume?.document || !resume.documentKind) return;
    setError(null);
    setRunning(true);
    try {
      const materials = await prepareMaterials(saved.materials);
      const runId = await services.startReview(
        resume.documentKind,
        resume.document,
        materials,
        saved.lastReview && {
          ...saved.lastReview,
          results: saved.lastReview.results.map((item) => ({
            ...item,
            검토출처: item.검토출처 ?? ["기본 검토"],
            검토자료근거: item.검토자료근거 ?? [],
          })),
        },
      );
      await store.setActiveRun(runId);
      await refresh();
      await finishRun(runId);
    } catch (caught) {
      setError(toApplicationApiError(caught, "이력서 검토를 시작하지 못했습니다."));
      setRunning(false);
    }
  }

  async function prepareMaterials(materials: MaterialRecord[]): Promise<ReferenceMaterial[]> {
    const prepared: ReferenceMaterial[] = [];
    for (const item of materials) {
      if (item.inputType === "url" && item.url) {
        prepared.push({
          sourceId: item.sourceId,
          materialType: item.materialType,
          inputType: "url",
          url: item.url,
        });
      } else if (item.content) {
        prepared.push({
          sourceId: item.sourceId,
          materialType: item.materialType,
          inputType: item.inputType,
          content: item.content,
        });
      } else if (item.original) {
        try {
          const file = new File([item.original], item.displayName);
          const extracted = await services.extractFile(file, classifyFile(file));
          const content =
            "text" in extracted.document
              ? extracted.document.text
              : extracted.document.pages
                  .flatMap((page) => page.blocks.flatMap((block) => block.lines.map((line) => line.text)))
                  .join("\n");
          await store.completeMaterialExtraction(item.sourceId, content);
          prepared.push({
            sourceId: item.sourceId,
            materialType: item.materialType,
            inputType: "document",
            content,
          });
        } catch (caught) {
          await store.failMaterialExtraction(item.sourceId);
          setError(toApplicationApiError(caught, `${item.displayName} 자료를 추출하지 못해 나머지 자료로 검토합니다.`));
        }
      }
    }
    return prepared;
  }

  async function cancelCurrentReview() {
    const runId = (await store.load()).activeRunId;
    if (runId) await services.cancelReview(runId);
  }

  async function retryModule(moduleKey: RetryModule) {
    const record = (await store.load()).reviewRecord;
    if (!record) return;
    setRunning(true);
    try {
      const { runId } = await services.retryReview(record, moduleKey);
      await store.setActiveRun(runId);
      await refresh();
      await finishRun(runId);
    } catch (caught) {
      setError(toApplicationApiError(caught, "모듈을 다시 실행하지 못했습니다."));
      setRunning(false);
    }
  }

  async function saveFeedback() {
    await store.saveReviewFeedback(feedback.trim());
    await refresh();
  }

  async function applyText() {
    let replacementStarted = false;
    try {
      setError(null);
      validateTextLength(resumeText, await resolvePolicy());
      await store.beginResumeReplacement({
        inputType: "text",
        displayName: "직접 입력 이력서",
        original: resumeText,
      });
      replacementStarted = true;
      setSelectedLineIds([]);
      setSelectedSuggestionNumber(undefined);
      await refresh();
      const document = await services.extractText(resumeText);
      await store.completeResumeExtraction("flow", document);
      await refresh();
    } catch (caught) {
      if (replacementStarted) {
        await store.failResumeExtraction();
        await refresh();
      }
      setError(toApplicationApiError(caught, "이력서를 변환하지 못했습니다."));
    }
  }

  async function applyFile(file?: File) {
    if (!file) return;
    let replacementStarted = false;
    try {
      setError(null);
      const kind = classifyFile(file);
      validateFileSize(file, kind, await resolvePolicy());
      await store.beginResumeReplacement({ inputType: "file", displayName: file.name, original: file });
      replacementStarted = true;
      setSelectedLineIds([]);
      setSelectedSuggestionNumber(undefined);
      await refresh();
      const extracted = await services.extractFile(file, kind);
      await store.completeResumeExtraction(extracted.kind, extracted.document);
      await refresh();
    } catch (caught) {
      if (replacementStarted) {
        await store.failResumeExtraction();
        await refresh();
      }
      setError(toApplicationApiError(caught, "이력서를 변환하지 못했습니다."));
    }
  }

  async function addTextMaterial(materialType: "company" | "jobPosting") {
    const value = materialType === "company" ? companyText.trim() : jobText.trim();
    if (!value) return;
    let url: string | undefined;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") url = parsed.toString();
    } catch {
      // Plain text material.
    }
    const material: MaterialRecord = {
      sourceId: crypto.randomUUID(),
      materialType,
      inputType: url ? "url" : "text",
      status: url ? "registered" : "extracted",
      displayName: value,
      ...(url ? { url } : { content: value }),
    };
    materialType === "company" ? setCompanyText("") : setJobText("");
    await store.addMaterial(material);
    setState((current) => ({ ...current, materials: [...current.materials, material] }));
  }

  async function addFileMaterial(materialType: "company" | "jobPosting", file?: File) {
    if (!file) return;
    try {
      const kind = classifyFile(file);
      validateFileSize(file, kind, await resolvePolicy());
      const material: MaterialRecord = {
        sourceId: crypto.randomUUID(),
        materialType,
        inputType: "document",
        status: "registered",
        displayName: file.name,
        original: file,
      };
      await store.addMaterial(material);
      setState((current) => ({ ...current, materials: [...current.materials, material] }));
    } catch (caught) {
      setError(toApplicationApiError(caught, "자료를 등록하지 못했습니다."));
    }
  }

  async function deleteMaterial(material: MaterialRecord) {
    if (!window.confirm(`'${material.displayName}' 자료를 삭제할까요?`)) return;
    await store.deleteMaterial(material.sourceId);
    setState((current) => ({
      ...current,
      materials: current.materials.filter((item) => item.sourceId !== material.sourceId),
    }));
  }

  const companyMaterials = state.materials.filter((item) => item.materialType === "company");
  const jobMaterials = state.materials.filter((item) => item.materialType === "jobPosting");
  const materialCount = state.materials.length;
  const resumeStatus = state.activeResume?.status === "ready"
    ? "변환 완료"
    : state.activeResume?.status === "extracting"
      ? "변환 중"
      : state.activeResume?.status === "failed"
        ? "변환 실패"
        : "이력서 없음";

  return (
    <div className="app-shell">
      <aside className="side-rail" aria-label="주 메뉴">
        <a className="wordmark" href="#workspace" aria-label="Resume Review 홈">RR</a>
        <nav>
          <a className="rail-link is-active" href="#workspace" aria-current="page">
            <FileText size={21} aria-hidden="true" />
            <span>이력서 검토</span>
          </a>
          <span className="rail-link is-disabled" aria-disabled="true">
            <ArrowCounterClockwise size={21} aria-hidden="true" />
            <span>검토 기록</span>
          </span>
          <span className="rail-link is-disabled" aria-disabled="true">
            <Gear size={21} aria-hidden="true" />
            <span>설정</span>
          </span>
        </nav>
        <p className="rail-note">원문은 유지하고<br />근거만 제안합니다.</p>
      </aside>

      <main className="dashboard-main" id="workspace">
        <header className="topbar">
          <div className="document-identity">
            <FileText size={22} aria-hidden="true" />
            <div>
              <h1>{state.activeResume?.displayName ?? "새 이력서"}</h1>
              <span className={state.activeResume?.status === "ready" ? "status-ready" : undefined}>
                {state.activeResume?.status === "ready" && <CheckCircle size={14} weight="fill" aria-hidden="true" />}
                {resumeStatus}
              </span>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              ref={materialsTrigger}
              className="button-secondary"
              type="button"
              aria-expanded={drawerOpen}
              aria-controls="materials-drawer"
              onClick={() => setDrawerOpen(true)}
            >
              <FolderOpen size={18} aria-hidden="true" />
              검토 자료
              {materialCount > 0 && <span className="count-badge">{materialCount}</span>}
            </button>
            {running ? (
              <button className="button-danger" type="button" onClick={() => void cancelCurrentReview()}>검토 취소</button>
            ) : (
              <button className="button-primary" type="button" onClick={() => void beginReview()} disabled={state.activeResume?.status !== "ready"}>
                <Play size={17} weight="fill" aria-hidden="true" />
                이력서 검토하기
              </button>
            )}
          </div>
        </header>

        <section className="resume-input" aria-labelledby="resume-heading">
          <div className="resume-input-heading">
            <h2 id="resume-heading">이력서 원본</h2>
            <span>PDF, 이미지, DOCX, TXT</span>
          </div>
          <div className="segmented-control" role="tablist" aria-label="이력서 입력 방식">
            <button disabled={running} type="button" role="tab" aria-selected={inputMode === "file"} onClick={() => setInputMode("file")}>파일</button>
            <button disabled={running} type="button" role="tab" aria-selected={inputMode === "text"} onClick={() => setInputMode("text")}>직접 입력</button>
          </div>
          {inputMode === "file" ? (
            <label className="file-picker">
              <UploadSimple size={18} aria-hidden="true" />
              {state.activeResume ? "이력서 교체" : "이력서 열기"}
              <input
                className="visually-hidden"
                aria-label="이력서 파일"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.gif,.tif,.tiff,.webp,.docx,.txt"
                onChange={(event) => void applyFile(event.target.files?.[0])}
                disabled={running}
              />
            </label>
          ) : (
            <div className="direct-input">
              <label>
                <span className="visually-hidden">이력서 텍스트</span>
                <textarea disabled={running} aria-label="이력서 텍스트" placeholder="이력서 내용을 붙여 넣으세요." value={resumeText} onChange={(event) => setResumeText(event.target.value)} />
              </label>
              <button type="button" onClick={() => void applyText()} disabled={running}>이력서 적용</button>
            </div>
          )}
        </section>

        <div className="review-workspace" role="region" aria-label="이력서 검토 작업 영역">
          <section ref={viewerPanel} className="viewer-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">DOCUMENT</span>
                <h2>문서 미리보기</h2>
              </div>
              <span className="panel-meta">원문 기준</span>
            </div>
            {state.activeResume?.status === "ready" ? (
              <ResumeViewer
                resume={state.activeResume}
                selectedLineIds={selectedLineIds}
                selectedSuggestionNumber={selectedSuggestionNumber}
              />
            ) : (
              <p className="panel-empty">이력서를 첨부하면<br />원문이 이곳에 표시됩니다.</p>
            )}
          </section>

          <section className="results-panel" aria-label="분석 결과">
            <div className="results-header">
              <div>
                <span className="eyebrow">REVIEW</span>
                <h2>분석 제안</h2>
              </div>
              {!running && state.currentReview && <span className="result-count">{state.currentReview.results.length}</span>}
            </div>
            {progress && (
              <p className="review-progress" role="status" aria-live="polite" aria-atomic="true">
                <span key={`${progress}-${progressDelayed}`}>
                  {progressDelayed ? "조금 더 꼼꼼히 확인하고 있습니다." : progress}
                </span>
              </p>
            )}
            {running ? (
              <ReviewSkeleton />
            ) : !state.currentReview ? (
              <p className="panel-empty">검토를 시작하면 문장별 수정 제안이 표시됩니다.</p>
            ) : (
              <>
                <p className="review-summary">{state.currentReview.status === "partial" ? "일부 자료를 제외하고 검토했습니다." : state.currentReview.status === "failed" ? "검토를 완료하지 못했습니다." : "검토가 완료되었습니다."}</p>
                {(state.currentReview.materialReviews ?? []).length > 0 && (
                  <div className="material-review-summary" aria-label="검토 자료 반영 결과">
                    {(["jobPosting", "company"] as const).map((type) => {
                      const reviews = (state.currentReview?.materialReviews ?? []).filter((item) => item.materialType === type);
                      if (!reviews.length) return null;
                      return (
                        <div key={type}>
                          <strong>{type === "jobPosting" ? "채용 공고" : "회사 자료"} 분석 완료 · 반영 {reviews.filter((item) => item.status === "applied").length}건</strong>
                          {reviews.filter((item) => item.status === "notApplied").map((item) => <p key={item.sourceId}>{item.reason}</p>)}
                        </div>
                      );
                    })}
                  </div>
                )}
                {state.currentReview.errors.length > 0 && (
                  <div className="review-errors" aria-label="검토 오류">
                    <h3>확인할 오류</h3>
                    {!state.reviewRecord && state.currentReview.errors.some((item) => item.canRetry) && (
                      <p>이전에 저장한 결과입니다. 다시 확인하려면 새 검토를 시작해 주세요.</p>
                    )}
                    <ul>
                      {state.currentReview.errors.map((item, index) => (
                        <li key={`${item.moduleKey}-${item.errorCode}-${index}`}>
                          <WarningCircle size={18} aria-hidden="true" />
                          <span>{item.userMessage}</span>
                          {item.canRetry && state.reviewRecord && (
                            <button type="button" disabled={running} onClick={() => void retryModule(item.moduleKey as RetryModule)}>모듈 다시 실행</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="suggestion-list">
                  {state.currentReview.results.map((item, index) => (
                    <article key={`${item.수정포인트위치.quote}-${index}`}>
                      <div className="suggestion-title">
                        <span className="suggestion-index">{index + 1}</span>
                        <strong>{item.수정성격}</strong>
                      </div>
                      <div className="suggestion-sources" aria-label="검토 출처">
                        {(item.검토출처 ?? ["기본 검토"]).map((source) => (
                          <span key={source}>{source}</span>
                        ))}
                      </div>
                      <div className="suggestion-comparison">
                        <span className="suggestion-label">기존 문장</span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedLineIds([...item.수정포인트위치.lineIds]);
                            setSelectedSuggestionNumber(index + 1);
                          }}
                          aria-label={`${item.수정포인트위치.quote} 제안 보기`}
                        >
                          <del>{item.수정포인트위치.quote}</del>
                        </button>
                        <span className="suggestion-label">수정 제안</span>
                        <p className="suggestion-rewrite">{item["실제 수정 예시"]}</p>
                      </div>
                      <div className="suggestion-reason">
                        <span className="suggestion-label">수정 원인 및 방향</span>
                        <p>{item["이유 및 제안"]}</p>
                      </div>
                      {(item.검토자료근거 ?? []).map((evidence) => {
                        const type = (state.currentReview?.materialReviews ?? []).find((review) => review.sourceId === evidence.sourceId)?.materialType;
                        return (
                          <div className="material-evidence" key={`${evidence.sourceId}-${evidence.consideredPoint}`}>
                            <span>{type === "jobPosting" ? "공고에서 고려한 점" : "회사 자료에서 고려한 점"}</span>
                            <p>{evidence.consideredPoint}</p>
                          </div>
                        );
                      })}
                    </article>
                  ))}
                </div>
                {state.lastReview && (
                  <div className="feedback-panel">
                    <label>
                      다음 검토에 반영할 의견
                      <textarea aria-label="다음 검토에 반영할 의견" value={feedback} onChange={(event) => setFeedback(event.target.value)} disabled={running} />
                    </label>
                    <p>현재 결과는 바뀌지 않으며, 저장한 의견은 다음 검토에 전달됩니다.</p>
                    <button type="button" disabled={running} onClick={() => void saveFeedback()}>의견 저장</button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      {drawerOpen && <button className="drawer-scrim" type="button" aria-label="검토 자료 바깥 영역 닫기" onClick={() => setDrawerOpen(false)} />}
      <aside ref={drawerPanel} id="materials-drawer" className="materials-drawer" role="dialog" aria-modal="true" aria-labelledby="materials-title" tabIndex={-1} hidden={!drawerOpen}>
        <div className="drawer-header">
          <div>
            <span className="eyebrow">REFERENCE</span>
            <h2 id="materials-title">검토 자료</h2>
          </div>
          <button className="icon-button" type="button" aria-label="검토 자료 닫기" onClick={() => setDrawerOpen(false)}>
            <X size={21} aria-hidden="true" />
          </button>
        </div>
        <p className="drawer-intro">지원할 회사와 역할에 맞춰 판단할 자료를 추가하세요.</p>
        <div className="drawer-tabs" role="tablist" aria-label="검토 자료 종류">
          <button type="button" role="tab" aria-selected={materialTab === "jobPosting"} onClick={() => setMaterialTab("jobPosting")}>채용 공고</button>
          <button type="button" role="tab" aria-selected={materialTab === "company"} onClick={() => setMaterialTab("company")}>회사 정보</button>
        </div>
        <div className="drawer-content">
          {materialTab === "jobPosting" ? (
            <MaterialSection
              title="채용 공고"
              inputLabel="채용 공고 입력"
              addLabel="채용 공고 추가"
              value={jobText}
              setValue={setJobText}
              materials={jobMaterials}
              onAdd={() => void addTextMaterial("jobPosting")}
              onFile={(file) => void addFileMaterial("jobPosting", file)}
              onDelete={(item) => void deleteMaterial(item)}
              disabled={running}
            />
          ) : (
            <MaterialSection
              title="회사 소개 자료"
              inputLabel="회사 소개 자료 입력"
              addLabel="회사 자료 추가"
              value={companyText}
              setValue={setCompanyText}
              materials={companyMaterials}
              onAdd={() => void addTextMaterial("company")}
              onFile={(file) => void addFileMaterial("company", file)}
              onDelete={(item) => void deleteMaterial(item)}
              disabled={running}
            />
          )}
        </div>
        <p className="drawer-footnote">등록한 자료는 이번 검토에만 사용되며, 원본 추출 후 임시 파일은 삭제됩니다.</p>
      </aside>
      <ErrorPopup error={error} onClose={() => setError(null)} />
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="review-skeleton" aria-label="분석 제안 생성 중" aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div className="skeleton-card" key={item} aria-hidden="true">
          <span className="skeleton-dot" />
          <span className="skeleton-line is-short" />
          <span className="skeleton-line" />
          <span className="skeleton-line is-medium" />
          <span className="skeleton-block" />
        </div>
      ))}
    </div>
  );
}

type MaterialSectionProps = {
  title: string;
  inputLabel: string;
  addLabel: string;
  value: string;
  setValue: (value: string) => void;
  materials: MaterialRecord[];
  onAdd: () => void;
  onFile: (file?: File) => void;
  onDelete: (item: MaterialRecord) => void;
  disabled: boolean;
};

function MaterialSection(props: MaterialSectionProps) {
  const urlCount = props.materials.filter((item) => item.inputType === "url").length;
  return (
    <section className="material-section">
      <div className="material-heading">
        <h3>{props.title}</h3>
        <span>{props.materials.length}</span>
      </div>
      <p>URL을 붙여넣거나 직접 내용을 입력할 수 있습니다.</p>
      <label>
        <span className="visually-hidden">{props.inputLabel}</span>
        <textarea disabled={props.disabled} aria-label={props.inputLabel} placeholder="URL 또는 자료 내용을 입력하세요." value={props.value} onChange={(event) => props.setValue(event.target.value)} />
      </label>
      <div className="material-actions">
        <button className="button-primary" disabled={props.disabled} type="button" onClick={props.onAdd}>{props.addLabel}</button>
        <label className="file-picker">
          <Paperclip size={17} aria-hidden="true" />
          파일 선택
          <input className="visually-hidden" disabled={props.disabled} type="file" aria-label={`${props.title} 파일`} onChange={(event) => props.onFile(event.target.files?.[0])} />
        </label>
      </div>
      {urlCount >= 2 && <p>여러 URL을 한 번에 분석하면 페이지별 분석 깊이가 낮아질 수 있습니다.</p>}
      {props.materials.length === 0 ? (
        <p className="material-empty">아직 등록한 자료가 없습니다.</p>
      ) : (
        <ul className="material-list">
          {props.materials.map((item) => (
            <li key={item.sourceId}>
              <FileText size={20} aria-hidden="true" />
              <div>
                <span>{item.displayName}</span>
                <small>{item.status === "extracted" ? "추출 완료" : item.status === "failed" ? "추출 실패" : "등록됨"}</small>
              </div>
              <button className="icon-button" disabled={props.disabled} type="button" aria-label={`${item.displayName} 삭제`} onClick={() => props.onDelete(item)}>
                <Trash size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { Fragment, useEffect, useRef, useState } from "react";
import { FilePdf, Plus } from "@phosphor-icons/react";
import { Pagination } from "../../components/Pagination";
import { PdfViewer } from "../../viewer/ResumeViewer";
import { ReviewDeskHeader } from "../workspaces/ReviewDeskHeader";
import type { Context } from "../../domain/context/entities";
import type { ComparisonSource, PortfolioGateway, PortfolioReview, PortfolioVersion } from "../../domain/review/portfolio";
import type { Workspace } from "../../domain/workspace/entities";
import type { WorkspaceRepository } from "../../domain/workspace/ports";

const pageWasReviewed = (review: PortfolioReview) =>
  review.textStatus === "complete" || review.imageStatus === "complete";

const categories = { message: "핵심 메시지", evidence: "근거", structure: "정보 구조", visual: "시각적 전달력" };

const conflictFields = { period: "기간", metric: "성과 수치", role: "역할" };
const citationKinds = { resume: "이력서", portfolio: "포트폴리오", experience: "경험 기록" };

function comparisonSources(workspace: Workspace, context: Context): ComparisonSource[] {
  const resume = workspace.resumeVersions.find(v => v.id === context.latestVersionId);
  const doc = resume?.document;
  const sources: ComparisonSource[] = [];
  if (resume && doc) {
    const blocks = "pages" in doc ? doc.pages.flatMap(p => p.blocks) : doc.blocks;
    const text = blocks.flatMap(block => block.lines.map(line => line.text)).join("\n").slice(0, 60_000);
    sources.push({ kind: "resume", id: resume.id, version: String(resume.version), title: resume.displayName, text });
  }
  const selected = new Set(context.selectedExperienceIds ?? []);
  let remaining = 120_000 - (sources[0]?.text.length ?? 0);
  for (const exp of workspace.experiences) {
    const text = exp.markdown?.trim();
    if (!text || (selected.size && !selected.has(exp.id)) || text.length > remaining || sources.length >= 101) continue;
    sources.push({ kind: "experience", id: exp.id, version: String(exp.revision), title: exp.title, text });
    remaining -= text.length;
  }
  return sources;
}

export function PortfolioReviewScreen({ context, workspace, store, services, disabled }: {
  context: Context; workspace: Workspace; store: WorkspaceRepository; services: Partial<PortfolioGateway>; disabled?: boolean;
}) {
  const versions = (workspace.portfolioVersions ?? []).filter(v => v.contextId === context.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [versionId, selectVersion] = useState("");
  const [page, selectPage] = useState(1);
  const [attemptId, selectAttempt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const version = versions.find(v => v.id === versionId) ?? versions[0];
  const reviewedPages = new Set((workspace.portfolioReviews ?? []).filter(r => r.portfolioVersionId === version?.id
    && pageWasReviewed(r)).map(r => r.pageNumber));
  const remainingPages = Array.from({ length: version?.pageCount ?? 0 }, (_, i) => i + 1).filter(n => !reviewedPages.has(n));
  const attempts = (workspace.portfolioReviews ?? []).filter(r => r.portfolioVersionId === version?.id && r.pageNumber === page)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const result = attempts.find(r => r.id === attemptId) ?? attempts.find(pageWasReviewed) ?? attempts[0];

  async function perform(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(label);
    setError("");
    try { await action(controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "작업을 완료하지 못했습니다.");
    } finally {
      request.current = null;
      setBusy("");
    }
  }

  async function reviewPages(target: PortfolioVersion, pages: number[], signal: AbortSignal) {
    const sources = target.original instanceof Blob ? comparisonSources(workspace, context) : [];
    for (const number of pages) {
      signal.throwIfAborted();
      setBusy(`${number}페이지 평가 중`);
      selectPage(number);
      selectAttempt("");
      const review = await services.reviewPortfolioPage!(target, number, signal, sources);
      signal.throwIfAborted();
      await store.savePortfolioReview(review);
      selectAttempt(review.id);
    }
  }

  return <section className="review-desk review-desk--portfolio">
    <ReviewDeskHeader contextId={context.id} title={context.name}
      identity={<><FilePdf size={15} aria-hidden="true" />포트폴리오 검토</>}
      actions={
      <label className="desk-upload"><Plus size={17} aria-hidden="true" />PDF 추가<input type="file" accept=".pdf,application/pdf" disabled={disabled || !!busy || !services.inspectPortfolio}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          void perform("PDF 확인 중", async signal => {
            const { pageCount } = await services.inspectPortfolio!(file, signal);
            signal.throwIfAborted();
            const id = crypto.randomUUID();
            await store.savePortfolioVersion({ id, contextId: context.id, name: file.name, original: file,
              pageCount, createdAt: new Date().toISOString() });
            selectVersion(id); selectPage(1); selectAttempt("");
          });
        }} /></label>
      }
      versionControl={version && <label>문서 버전 <select value={version.id} disabled={!!busy} onChange={e => {
        selectVersion(e.target.value); selectPage(1); selectAttempt("");
      }}>{versions.map(v => <option key={v.id} value={v.id}>{v.name} · {new Date(v.createdAt).toLocaleString("ko-KR")}</option>)}</select></label>} />
    {busy && <p className="desk-notice" role="status">{busy} <button onClick={() => request.current?.abort()}>취소</button></p>}
    {error && <p className="desk-notice" role="alert">{error}</p>}
    {!version ? <p className="panel-empty">검토할 PDF를 추가하세요. 25 MB, 30페이지까지 지원합니다.</p> :
      <div className="desk-panes">
        <section className="desk-portfolio-viewer" aria-label="포트폴리오 미리보기">
          <div className="panel-heading"><h2>문서 미리보기</h2><span className="panel-meta">{version.name}</span></div>
          <fieldset disabled={!!busy} className="portfolio-pagination"><Pagination label="포트폴리오 페이지" page={page} pageCount={version.pageCount}
            onPageChange={next => { selectPage(next); selectAttempt(""); }} /></fieldset>
          <PdfViewer file={version.original instanceof Blob ? version.original : version.original.downloadUrl}
            document={{ pages: [{ pageNumber: page, blocks: [] }] }} selectedLineIds={[]} />
        </section>
        <section className="results-panel" aria-label="페이지 평가">
          <div className="results-header"><h2>{page}페이지 평가</h2>
            <button className="button-secondary" disabled={disabled || !!busy || !services.reviewPortfolioPage} onClick={() =>
              void perform(`${page}페이지 평가 중`, signal => reviewPages(version, [page], signal))
            }>{result ? "다시 평가" : "페이지 평가"}</button>
            {remainingPages.some(number => number !== page) && <button disabled={disabled || !!busy || !services.reviewPortfolioPage} onClick={() =>
              void perform("평가되지 않은 페이지 검토 중", signal => reviewPages(version, remainingPages, signal))
            }>남은 페이지 평가 ({remainingPages.length})</button>}</div>
          {attempts.length > 1 && <label>평가 기록 <select value={result?.id} onChange={e => selectAttempt(e.target.value)}>
            {attempts.map(a => <option key={a.id} value={a.id}>{new Date(a.createdAt).toLocaleString("ko-KR")} · {pageWasReviewed(a) ? "결과 있음" : "실패"}</option>)}
          </select></label>}
          {!result && <p className="portfolio-result-empty" key={page}>이 페이지의 평가 기록이 없습니다.</p>}
          {result && <Fragment key={result.id}>
            <p className="desk-modality"><span className="desk-tag" data-status={result.textStatus === "complete" ? "matched" : undefined}>텍스트 · {{ complete: "평가 완료", unavailable: "추출된 텍스트 없음", failed: "평가 실패" }[result.textStatus]}
              </span><span className="desk-tag" data-status={result.imageStatus === "complete" ? "matched" : undefined}>이미지 · {result.imageStatus === "complete" ? "평가 완료" : "평가 미완료"}</span></p>
            {!result.findings.length && (result.textStatus === "complete" || result.imageStatus === "complete") && <p>완료된 평가에서 수정 제안을 찾지 못했습니다.</p>}
            <section className="portfolio-consistency" aria-label="문서 간 일관성">
              <h3>문서 간 일관성</h3>
              {result.comparisonStatus === "complete"
                ? !result.conflicts?.length && <p>비교한 자료에서 차이를 찾지 못했습니다.</p>
                : <p>{result.comparisonStatus === "failed" ? "비교를 완료하지 못했습니다." : "비교 결과가 없습니다."}</p>}
              {result.conflicts?.map((conflict, index) => <article key={index}>
                <h4>{conflict.project} · {conflictFields[conflict.field]} 확인</h4>
                <div className="portfolio-citations">{[conflict.left, conflict.right].map(citation =>
                  <blockquote key={citation.kind + citation.id}>
                    <strong>{citationKinds[citation.kind]} · {citation.title}</strong>
                    <small>{citation.kind === "portfolio" ? `${result.pageNumber}페이지` : `버전 ${citation.version}`}</small>
                    <p>{citation.quote}</p>
                  </blockquote>)}</div>
              </article>)}
            </section>
            <div className="suggestion-list desk-findings">{!!result.findings.length && <h3>페이지 수정 제안</h3>}{result.findings.map((finding, index) => <article key={index}>
              <h4>{categories[finding.category]}</h4>
              {finding.basis === "text" && finding.quote && <blockquote>{finding.quote}</blockquote>}
              {finding.basis === "image" && <small>페이지 이미지</small>}
              <p>{finding.diagnosis}</p><p className="desk-change">{finding.proposedChange}</p>
            </article>)}</div>
          </Fragment>}
        </section>
      </div>}
  </section>;
}

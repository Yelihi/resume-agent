import type { OriginalFile } from "../shared/files";

export type PortfolioVersion = { id: string; contextId: string; name: string; createdAt: string; pageCount: number; original: OriginalFile };
export type PortfolioFinding = { basis: "text" | "image"; category: "message" | "evidence" | "structure" | "visual";
  quote: string | null; bbox: { x: number; y: number; width: number; height: number } | null; diagnosis: string; proposedChange: string };
export type ComparisonSource = { kind: "resume" | "experience"; id: string; version: string; title: string; text: string };
type EvidenceCitation = { kind: "portfolio" | ComparisonSource["kind"]; id: string; version: string; title: string; quote: string; value: string };
export type DocumentConflict = { project: string; field: "period" | "metric" | "role"; left: EvidenceCitation; right: EvidenceCitation };

export type PortfolioReview = { id: string; contextId: string; portfolioVersionId: string; pageNumber: number; createdAt: string;
  policyVersion: "portfolio-1"; text: string; textStatus: "complete" | "unavailable" | "failed"; imageStatus: "complete" | "failed"; findings: PortfolioFinding[];
  comparisonStatus?: "complete" | "unavailable" | "failed"; conflicts?: DocumentConflict[] };

export interface PortfolioGateway {
  inspectPortfolio(file: File, signal: AbortSignal): Promise<{ pageCount: number }>;
  reviewPortfolioPage(version: PortfolioVersion, page: number, signal: AbortSignal, comparison: ComparisonSource[]): Promise<PortfolioReview>;
}

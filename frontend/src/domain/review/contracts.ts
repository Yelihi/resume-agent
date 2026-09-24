// Domain value contracts; infrastructure adapters must satisfy these types.
import type { ModuleErrorDTO } from "../shared/contracts";
import type { MaterialType, ReferenceMaterial, MaterialSummary } from "../material/contracts";
import type { PageDocument, FlowDocument } from "../resume/contracts";

export type ExperienceCandidate = { id: string; title: string; period: string; revision: number; markdown: string; metadata: string };
export type ExperienceRecommendation = {
  experienceId: string; decision: "include" | "suggest" | "omit"; reason: string;
  jobEvidence: MaterialEvidence[]; resumeBullets: string[]; placement: string;
};

export type ReviewResponse = {
            experienceRecommendations?: ExperienceRecommendation[];
            /** Resolutionchecks */
            resolutionChecks?: ResolutionCheck[];
            status: ReviewStatus;
            /** Errors */
            errors: ModuleErrorDTO[];
            /** Materialreviews */
            materialReviews: MaterialReviewDTO[];
            /** Results */
            results: SuggestionDTO[];
        };

export type ResolutionCheck = {
            /** Suggestionid */
            suggestionId: string;
            /**
             * Status
             * @enum {string}
             */
            status: "resolved" | "notApplied" | "uncertain";
            /** Reason */
            reason: string;
            evidence?: SuggestionLocation | null;
        };

export type SuggestionLocation = {
            /** Lineids */
            lineIds: string[];
            /** Quote */
            quote: string;
        };

export type ReviewStatus = "success" | "partial" | "failed" | "cancelled";

export type MaterialReviewDTO = {
            /** Sourceid */
            sourceId: string;
            materialType: MaterialType;
            /**
             * Status
             * @enum {string}
             */
            status: "applied" | "notApplied";
            /** Reason */
            reason: string;
        };

export type SuggestionDTO = {
            /** Id */
            id?: string | null;
            /** Previoussuggestionid */
            previousSuggestionId?: string | null;
            "\uC218\uC815\uD3EC\uC778\uD2B8\uC704\uCE58": SuggestionLocation;
            /**
             * 수정성격
             * @enum {string}
             */
            "\uC218\uC815\uC131\uACA9": "맞춤법" | "사실성" | "근거" | "직무 관련성" | "회사 맥락" | "뉘앙스" | "가독성" | "기밀";
            /** 검토출처 */
            "\uAC80\uD1A0\uCD9C\uCC98": ("기본 검토" | "채용 공고" | "회사 자료")[];
            /** 검토자료근거 */
            "\uAC80\uD1A0\uC790\uB8CC\uADFC\uAC70": MaterialEvidence[];
            /** 이유 및 제안 */
            "\uC774\uC720 \uBC0F \uC81C\uC548": string;
            /** 실제 수정 예시 */
            "\uC2E4\uC81C \uC218\uC815 \uC608\uC2DC": string;
        };

export type MaterialEvidence = {
            /** Sourceid */
            sourceId: string;
            /** Consideredpoint */
            consideredPoint: string;
        };

export type ReviewRecord = {
            /** Runid */
            runId: string;
            reviewContext?: ReviewContext | null;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Document */
            document: PageDocument | FlowDocument;
            /** Materials */
            materials: ReferenceMaterial[];
            previousReview?: PreviousReview | null;
            moduleResults: CompletedModules;
            response: ReviewResponse;
        };

export type ReviewContext = {
            experiences?: ExperienceCandidate[];
            selectedExperienceIds?: string[];
            /** Contextid */
            contextId: string;
            /** Resumeversionid */
            resumeVersionId: string;
            /** Materialversions */
            materialVersions?: {
                [key: string]: string;
            };
            /** Previousreviewid */
            previousReviewId?: string | null;
            /** Feedback */
            feedback?: SuggestionFeedback[];
            /** Resolved */
            resolved?: ResolvedMemory[];
            /** Userfeedback */
            userFeedback?: string | null;
        };

export type SuggestionFeedback = {
            /** Id */
            id: string;
            /** Contextid */
            contextId: string;
            /** Reviewid */
            reviewId: string;
            /**
             * Decision
             * @enum {string}
             */
            decision: "resolve" | "skip";
            /** Rating */
            rating?: ("up" | "down") | null;
            suggestion: SuggestionDTO;
        };

export type ResolvedMemory = {
            /** Suggestionid */
            suggestionId: string;
            /** Quote */
            quote: string;
            /** Reason */
            reason: string;
        };

export type PreviousReview = {
            /** Results */
            results: SuggestionDTO[];
            /** Userfeedback */
            userFeedback?: string | null;
        };

export type CompletedModules = {
            spellCheck: ModuleResult_list_SpellDiagnostic__;
            companyContextAnalysis?: ModuleResult_ContextAnalysis_ | null;
            jobPostingAnalysis?: ModuleResult_ContextAnalysis_ | null;
            finalReview: ModuleResult_AiReviewOutput_;
        };

export type ModuleResult_list_SpellDiagnostic__ = {
            /** Modulekey */
            moduleKey: string;
            /** Output */
            output: SpellDiagnostic[] | null;
            /** Errors */
            errors: ModuleErrorDTO[];
        };

export type SpellDiagnostic = {
            /** Lineid */
            lineId: string;
            /** Quote */
            quote: string;
            /** Replacement */
            replacement: string;
            /** Reason */
            reason: string;
        };

export type ModuleResult_ContextAnalysis_ = {
            /** Modulekey */
            moduleKey: string;
            output: ContextAnalysis | null;
            /** Errors */
            errors: ModuleErrorDTO[];
        };

export type ContextAnalysis = {
            /** Summary */
            summary: string;
            /** Evidence */
            evidence: ContextEvidence[];
            /** Materialsummaries */
            materialSummaries?: MaterialSummary[];
        };

export type ContextEvidence = {
            /** Sourceid */
            sourceId: string;
            /** Statement */
            statement: string;
        };

export type ModuleResult_AiReviewOutput_ = {
            /** Modulekey */
            moduleKey: string;
            output: AiReviewOutput | null;
            /** Errors */
            errors: ModuleErrorDTO[];
        };

export type AiReviewOutput = {
            experienceRecommendations?: ExperienceRecommendation[];
            /** Resolutionchecks */
            resolutionChecks?: ResolutionCheck[];
            /** Materialreviews */
            materialReviews: MaterialReviewDTO[];
            /** Results */
            results: SuggestionDTO[];
        };

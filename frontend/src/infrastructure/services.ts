import type { ApplicationServices } from "../domain/workspace/services";
import { previewMaterial } from "./material/http";
import { writeExperience, draftExperience, experienceMetadata } from "./experience/http";
import { extractFile, extractText, getValidationPolicy } from "./resume/http";
import { cancelReview, followReview, getReviewRecord, releaseReview, retryReview, startReview } from "./review/http";
import { getAccount, saveOpenAiKey, deleteOpenAiKey, getBackupStatus } from "./account/http";
import { exportWorkspace, importWorkspace } from "./workspace/transfer";

export const defaultServices: ApplicationServices = { getValidationPolicy, extractText, extractFile, startReview, followReview, getReviewRecord, releaseReview, cancelReview, retryReview, previewMaterial, writeExperience, draftExperience, experienceMetadata, getAccount, saveOpenAiKey, deleteOpenAiKey, getBackupStatus, exportWorkspace, importWorkspace };

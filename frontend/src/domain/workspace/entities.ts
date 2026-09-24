import type { Context } from "../context/entities";
import type { ResumeVersion } from "../resume/entities";
import type { Material, MaterialVersion, ContextMaterial } from "../material/entities";
import type { Review, SuggestionEntry, ReviewMaterial, PendingRun } from "../review/entities";
import type { Experience, ExperienceDocument } from "../experience/entities";

export type Workspace = { contexts: Context[]; resumeVersions: ResumeVersion[]; materials: Material[];
  materialVersions: MaterialVersion[]; contextMaterials: ContextMaterial[]; reviews: Review[];
  suggestions: SuggestionEntry[]; reviewMaterials: ReviewMaterial[]; activeRun?: PendingRun;
  experiences: Experience[]; experienceDocuments: ExperienceDocument[] };
export const emptyWorkspace = (): Workspace => ({ contexts: [], resumeVersions: [], materials: [], materialVersions: [], contextMaterials: [], reviews: [], suggestions: [], reviewMaterials: [], experiences: [], experienceDocuments: [] });

import type { MaterialDraft } from "./entities";
export interface MaterialGateway {
  previewMaterial(materialType: MaterialDraft["materialType"], content: string): Promise<{ content: string; sources: string[] }>;
}

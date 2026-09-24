import type { Workspace } from "../../domain/workspace/entities";

// IndexedDB clones values on reads. Retain equal records so unrelated writes do not reload viewers.
// ponytail: compare local record payloads on refresh; persisted revisions if large libraries make this costly.
function shareRecords<RecordType extends { id: string }>(previous: RecordType[], incoming: RecordType[]): RecordType[] {
  const byId = new Map(previous.map(record => [record.id, record]));
  const records = incoming.map(record => {
    const existing = byId.get(record.id);
    return existing && JSON.stringify(existing) === JSON.stringify(record) ? existing : record;
  });
  return records.length === previous.length && records.every((record, index) => record === previous[index]) ? previous : records;
}

export function reconcileWorkspace(previous: Workspace, incoming: Workspace): Workspace {
  // Original blobs are immutable within a resume-version ID; retirement removes the original entirely.
  const previousVersions = new Map(previous.resumeVersions.map(version => [version.id, version]));
  const resumeVersions = incoming.resumeVersions.map(version => {
    const existing = previousVersions.get(version.id);
    return existing?.original instanceof Blob && version.original instanceof Blob
      ? { ...version, original: existing.original } : version;
  });
  const workspace: Workspace = {
    experiences: shareRecords(previous.experiences, incoming.experiences),
    experienceDocuments: shareRecords(previous.experienceDocuments, incoming.experienceDocuments),
    contexts: shareRecords(previous.contexts, incoming.contexts),
    resumeVersions: shareRecords(previous.resumeVersions, resumeVersions),
    materials: shareRecords(previous.materials, incoming.materials),
    materialVersions: shareRecords(previous.materialVersions, incoming.materialVersions),
    contextMaterials: shareRecords(previous.contextMaterials, incoming.contextMaterials),
    reviews: shareRecords(previous.reviews, incoming.reviews),
    suggestions: shareRecords(previous.suggestions, incoming.suggestions),
    reviewMaterials: shareRecords(previous.reviewMaterials, incoming.reviewMaterials),
    activeRun: JSON.stringify(previous.activeRun) === JSON.stringify(incoming.activeRun) ? previous.activeRun : incoming.activeRun,
  };
  return (Object.keys(workspace) as (keyof Workspace)[]).every(key => workspace[key] === previous[key]) ? previous : workspace;
}

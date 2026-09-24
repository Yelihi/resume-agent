import { useSyncExternalStore } from "react";
import type { WorkspaceRepository } from "../domain/workspace/ports";

export function useWorkspace(store: WorkspaceRepository) {
  const workspace = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const loaded = useSyncExternalStore(store.subscribe, store.getLoaded, store.getLoaded);
  return { workspace, loaded, refresh: store.load };
}

/** Select a stable record, collection, or primitive; derive fresh arrays outside the subscription. */
export function useWorkspaceSelector<Selection>(store: WorkspaceRepository, select: (workspace: ReturnType<WorkspaceRepository["getSnapshot"]>) => Selection): Selection {
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()), () => select(store.getSnapshot()));
}

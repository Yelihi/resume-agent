import { createContext, useContext } from "react";
import { useOutletContext } from "react-router";
import type { ApplicationController, ApplicationDependencies } from "../application/useApplication";
import type { WorkspaceRepository } from "../domain/workspace/ports";

export const ApplicationDependenciesContext = createContext<ApplicationDependencies | null>(null);
export function useApplicationDependencies() {
  const dependencies = useContext(ApplicationDependenciesContext);
  if (!dependencies) throw new Error("Application dependencies are missing");
  return dependencies;
}
export function useApplicationView() {
  return useOutletContext<{ application: ApplicationController; store: WorkspaceRepository }>();
}

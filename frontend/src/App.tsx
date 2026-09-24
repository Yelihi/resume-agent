import { lazy, Suspense, useMemo } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { defaultServices } from "./infrastructure/services";
import { confirmInBrowser } from "./infrastructure/browser/confirm";
import { IndexedDbWorkspaceRepository } from "./infrastructure/workspace/IndexedDbWorkspaceRepository";
import type { ApplicationServices } from "./domain/workspace/services";
import type { ApplicationDependencies } from "./application/useApplication";
import { ApplicationDependenciesContext } from "./views/context";
import { ApplicationLayout } from "./views/ApplicationLayout";
import { WorkspaceListView } from "./views/WorkspaceListView";
import { WorkspaceView } from "./views/WorkspaceView";
import { ResumeUploadView } from "./views/ResumeUploadView";
import { MaterialLibraryView } from "./views/MaterialLibraryView";
import { NotFoundView } from "./views/NotFoundView";
import { RouteErrorView } from "./views/RouteErrorView";
import { ExperienceLibraryView } from "./views/ExperienceLibraryView";
import { SettingsView } from "./views/SettingsView";
const ExperienceWritingView = lazy(() => import("./views/ExperienceWritingView").then(module => ({ default: module.ExperienceWritingView })));

export const appRoutes: RouteObject[] = [{
  path: "/", element: <ApplicationLayout />, errorElement: <RouteErrorView />,
  children: [
    { index: true, element: <Navigate to="/contexts" replace />, handle: { page: "list" } },
    { path: "contexts", element: <WorkspaceListView />, handle: { page: "list" } },
    { path: "contexts/new", element: <ResumeUploadView />, handle: { page: "new" } },
    { path: "contexts/:contextId", element: <WorkspaceView />, handle: { page: "context" } },
    { path: "contexts/:contextId/upload", element: <ResumeUploadView />, handle: { page: "upload" } },
    { path: "materials", element: <MaterialLibraryView />, handle: { page: "materials" } },
    { path: "experiences", element: <ExperienceLibraryView />, handle: { page: "experiences" } },
    { path: "settings", element: <SettingsView />, handle: { page: "settings" } },
    { path: "contexts/:contextId/experiences", element: <Suspense fallback={<p className="panel-empty" role="status">작성 화면을 불러오고 있습니다.</p>}><ExperienceWritingView /></Suspense>, handle: { page: "writing" } },
    { path: "*", element: <NotFoundView />, handle: { page: "notFound" } },
  ],
}];
export const createAppRouter = () => createBrowserRouter(appRoutes);
const defaultStore = new IndexedDbWorkspaceRepository();
export type AppProps = { router: ReturnType<typeof createAppRouter>; store?: ApplicationDependencies["store"]; services?: Partial<ApplicationServices>; confirm?: ApplicationDependencies["confirm"]; preview?: boolean };

export function App({ router, store = defaultStore, services: overrides, confirm = confirmInBrowser, preview = false }: AppProps) {
  const services = useMemo(() => ({ ...defaultServices, ...overrides }), [overrides]);
  const dependencies = useMemo(() => ({ store, services, confirm, preview }), [store, services, confirm, preview]);
  return <ApplicationDependenciesContext.Provider value={dependencies}><RouterProvider router={router} /></ApplicationDependenciesContext.Provider>;
}

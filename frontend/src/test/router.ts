import { createMemoryRouter } from "react-router";
import { afterEach } from "vitest";
import { appRoutes } from "../App";
const routers: ReturnType<typeof createMemoryRouter>[] = [];
export function createTestRouter(initialEntries = [window.location.pathname + window.location.search]) {
  const router = createMemoryRouter(appRoutes, { initialEntries });
  routers.push(router);
  return router;
}
afterEach(() => { routers.splice(0).forEach(router => router.dispose()); });

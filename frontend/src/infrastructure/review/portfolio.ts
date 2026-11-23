import type { PortfolioGateway } from "../../domain/review/portfolio";
import { apiFetch } from "../http/client";

export const portfolioGateway: PortfolioGateway = {
  inspectPortfolio(file, signal) {
    const body = new FormData();
    body.set("file", file);
    return apiFetch("/api/portfolio/inspect", { method: "POST", body, signal });
  },
  reviewPortfolioPage(version, page, signal, comparison) {
    const body = new FormData();
    body.set("contextId", version.contextId);
    if (version.original instanceof Blob) {
      body.set("file", version.original, version.name);
      body.set("comparison", JSON.stringify({ sources: comparison }));
    }
    return apiFetch(`/api/portfolio/versions/${encodeURIComponent(version.id)}/pages/${page}`, { method: "POST", body, signal });
  },
};

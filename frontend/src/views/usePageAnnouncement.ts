import { useEffect } from "react";
import { useLocation } from "react-router";

/** Announce committed pages without moving focus out of an open modal. */
export function usePageAnnouncement(ready = true) {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!ready) return;
    const main = document.getElementById("workspace");
    const heading = main?.querySelector("h1")?.textContent;
    document.title = heading ? `${heading} · Resume Review` : "Resume Review";
    if (!document.querySelector("dialog[open]")) main?.focus();
  }, [pathname, ready]);
}

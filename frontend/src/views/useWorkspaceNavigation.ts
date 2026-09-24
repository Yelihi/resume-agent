import { useEffect, useRef } from "react";
import { useBeforeUnload, useBlocker, useLocation, useNavigate } from "react-router";
import type { ConfirmAction } from "../domain/shared/interaction";
import type { Navigate } from "../application/navigation";

/** Router owns history; this hook adapts the draft/busy guard to navigation. */
export function useWorkspaceNavigation({ dirty, busy, confirm, onLeave }: {
  dirty: boolean; busy: boolean; confirm: ConfirmAction; onLeave: () => void;
}) {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const afterSave = useRef(false);
  const locationPath = location.pathname + location.search + location.hash;
  const previousPath = useRef(locationPath);
  useBlocker(({ currentLocation, nextLocation }) => {
    if (afterSave.current) return false;
    if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search && currentLocation.hash === nextLocation.hash) return false;
    return busy || (dirty && !confirm("저장하지 않은 내용을 버리고 이동할까요?"));
  });
  useBeforeUnload(event => {
    if (dirty || busy) { event.preventDefault(); event.returnValue = ""; }
  });
  useEffect(() => {
    if (previousPath.current === locationPath) return;
    previousPath.current = locationPath;
    onLeave();
  }, [locationPath, onLeave]);
  const navigate: Navigate = (path, saved = false) => {
    afterSave.current = saved;
    try { void routerNavigate(path); }
    finally { afterSave.current = false; }
  };
  return { navigate };
}

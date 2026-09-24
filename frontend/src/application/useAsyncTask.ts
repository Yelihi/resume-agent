import { useCallback, useRef, useState } from "react";
import { toApplicationApiError, type ApplicationApiError } from "../domain/shared/errors";

export type RunTask = (action: () => Promise<void>, failureMessage: string) => Promise<void>;
export type ReportError = (error: unknown, fallbackMessage: string) => void;

export function useAsyncTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApplicationApiError | null>(null);
  const pending = useRef(false);
  const reportError = useCallback<ReportError>((caught, fallback) => setError(toApplicationApiError(caught, fallback)), []);
  const runTask = useCallback<RunTask>(async (action, failureMessage) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (caught) { reportError(caught, failureMessage); }
    finally { pending.current = false; setBusy(false); }
  }, [reportError]);
  return { busy, error, reportError, runTask, clearError: () => setError(null) };
}

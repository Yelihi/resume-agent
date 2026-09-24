import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

/** Async results belong to the draft that started them, until replacement or unmount. */
export function useDraftState<Draft>(initial: Draft) {
  const [draft, setState] = useState(initial);
  const current = useRef(initial);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const setDraft = useCallback((change: SetStateAction<Draft>) => {
    current.current = typeof change === "function" ? (change as (previous: Draft) => Draft)(current.current) : change;
    setState(current.current);
  }, []);
  const ownsDraft = useCallback((original: Draft) => mounted.current && current.current === original, []);
  return [draft, setDraft, ownsDraft] as const;
}

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

export type DialogProps = {
  labelledBy?: string;
  label?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  busy?: boolean;
  onDismiss: () => void;
  children: ReactNode;
};

/** Mount while open. The browser owns focus containment and background inertness. */
export function Dialog({ labelledBy, label, initialFocusRef, className, busy = false, onDismiss, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    initialFocusRef?.current?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [initialFocusRef]);

  return <dialog ref={dialogRef} className={className} aria-labelledby={labelledBy} aria-label={label} aria-busy={busy || undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onDismiss(); }}>
    {children}
  </dialog>;
}

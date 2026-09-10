import { WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import type { ApplicationApiError } from "../api/client";

type ErrorPopupProps = {
  error: ApplicationApiError | null;
  onClose: () => void;
};

export function ErrorPopup({ error, onClose }: ErrorPopupProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !error || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, [error]);

  if (!error) return null;

  const close = () => {
    dialogRef.current?.close?.();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="error-dialog"
      aria-labelledby="error-dialog-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <header className="error-dialog-header">
        <span className="error-dialog-icon"><WarningCircle size={22} weight="fill" aria-hidden="true" /></span>
        <div>
          <span className="eyebrow">ERROR</span>
          <h2 id="error-dialog-title">요청 오류</h2>
        </div>
        <button className="icon-button" type="button" aria-label="오류 팝업 닫기" onClick={close}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="error-dialog-body">
        <p role="alert">{error.message}</p>
        <code>{error.code}</code>
      </div>
      <footer className="error-dialog-actions">
        <button className="button-primary" type="button" onClick={close}>확인</button>
      </footer>
    </dialog>
  );
}

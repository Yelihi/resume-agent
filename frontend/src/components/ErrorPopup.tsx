import { WarningCircle, X } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";

import type { ApplicationApiError } from "../domain/shared/errors";

type ErrorPopupProps = {
  error: ApplicationApiError | null;
  onClose: () => void;
};

export function ErrorPopup({ error, onClose }: ErrorPopupProps) {
  if (!error) return null;

  return (
    <Dialog className="error-dialog" labelledBy="error-dialog-title" onDismiss={onClose}>
      <header className="error-dialog-header">
        <span className="error-dialog-icon"><WarningCircle size={22} weight="fill" aria-hidden="true" /></span>
        <div>
          <span className="eyebrow">ERROR</span>
          <h2 id="error-dialog-title">요청 오류</h2>
        </div>
        <button className="icon-button" type="button" aria-label="오류 팝업 닫기" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="error-dialog-body">
        <p role="alert">{error.message}</p>
        <code>{error.code}</code>
      </div>
      <footer className="error-dialog-actions">
        <button className="button-primary" type="button" onClick={onClose}>확인</button>
      </footer>
    </Dialog>
  );
}

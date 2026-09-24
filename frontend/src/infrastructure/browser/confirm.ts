import type { ConfirmAction } from "../../domain/shared/interaction";

export const confirmInBrowser: ConfirmAction = message => window.confirm(message);

import type { FiledReturnsMainWorldCaptureRequest } from "../../core/contracts";
import {
  GSTR2B_CAPTURE_CONTROL_ATTRIBUTE,
  GSTR2B_CAPTURE_MAX_BYTES,
} from "./gstr2b-capture-bridge";

export function prepareGstr2bPortalBlobDownloadCapture(
  documentRef: Document,
  control: HTMLElement,
  actionId: string,
): FiledReturnsMainWorldCaptureRequest | null {
  return prepareFiledReturnsPortalBlobDownloadCapture(documentRef, control, actionId, {
    signalPrefix: "gstr2b",
    timeoutMs: 12_000,
  });
}

export function prepareFiledReturnsPortalBlobDownloadCapture(
  documentRef: Document,
  control: HTMLElement,
  actionId: string,
  options: { signalPrefix: string; timeoutMs?: number },
): FiledReturnsMainWorldCaptureRequest | null {
  const view = documentRef.defaultView;
  if (!view) return null;

  const controlId = createCaptureToken(view);
  control.setAttribute(GSTR2B_CAPTURE_CONTROL_ATTRIBUTE, controlId);
  return {
    actionId,
    controlAttribute: GSTR2B_CAPTURE_CONTROL_ATTRIBUTE,
    controlId,
    maxBytes: GSTR2B_CAPTURE_MAX_BYTES,
    signalPrefix: options.signalPrefix,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  };
}

function createCaptureToken(view: Window): string {
  const bytes = new Uint8Array(16);
  view.crypto?.getRandomValues?.(bytes);
  if (bytes.some((byte) => byte !== 0)) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

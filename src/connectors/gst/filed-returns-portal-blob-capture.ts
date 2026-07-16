import type { FiledReturnsMainWorldCaptureRequest } from "../../core/contracts";

// Keep the established attribute value because in-flight capture requests persist it across worlds.
const FILED_RETURNS_CAPTURE_CONTROL_ATTRIBUTE = "data-pack-gstr2b-capture-action";
const FILED_RETURNS_CAPTURE_MAX_BYTES = 36 * 1024 * 1024;

export function prepareFiledReturnsPortalBlobDownloadCapture(
  documentRef: Document,
  control: HTMLElement,
  actionId: string,
  options: { signalPrefix: string; timeoutMs?: number },
): FiledReturnsMainWorldCaptureRequest | null {
  const view = documentRef.defaultView;
  if (!view) return null;

  const controlId = createCaptureToken(view);
  control.setAttribute(FILED_RETURNS_CAPTURE_CONTROL_ATTRIBUTE, controlId);
  return {
    actionId,
    controlAttribute: FILED_RETURNS_CAPTURE_CONTROL_ATTRIBUTE,
    controlId,
    maxBytes: FILED_RETURNS_CAPTURE_MAX_BYTES,
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

import type { FiledReturnsCapturedDownloadRequest } from "../../core/contracts";
import { activateElement } from "./filed-returns-dom";
import {
  GSTR2B_CAPTURE_CONTROL_ATTRIBUTE,
  GSTR2B_CAPTURE_MAX_BYTES,
  GSTR2B_CAPTURE_MESSAGE_SOURCE,
  GSTR2B_CAPTURE_TIMEOUT_MS,
  type Gstr2bCaptureRequestMessage,
} from "./gstr2b-capture-bridge";

interface CapturedBlobPayload {
  actionId: string;
  dataUrl: string;
  nonce: string;
  safeSignals: string[];
}

export async function captureGstr2bPortalBlobDownload(
  documentRef: Document,
  control: HTMLElement,
  actionId: string,
): Promise<FiledReturnsCapturedDownloadRequest | null> {
  const view = documentRef.defaultView;
  if (!view) return null;

  const controlId = createCaptureToken(view);
  const nonce = createCaptureToken(view);
  const sameWorldCapture = installBlobCapture(view, actionId, nonce);
  control.setAttribute(GSTR2B_CAPTURE_CONTROL_ATTRIBUTE, controlId);

  return new Promise((resolve) => {
    let settled = false;
    let acked = false;
    const timeoutId = view.setTimeout(() => settle(null), GSTR2B_CAPTURE_TIMEOUT_MS);
    const fallbackId = view.setTimeout(() => {
      if (!acked && isJsdomWindow(view)) activateElement(control);
    }, 100);

    const cleanup = () => {
      view.clearTimeout(timeoutId);
      view.clearTimeout(fallbackId);
      view.removeEventListener("message", onMessage);
      sameWorldCapture.restore();
      control.removeAttribute(GSTR2B_CAPTURE_CONTROL_ATTRIBUTE);
    };

    const settle = (request: FiledReturnsCapturedDownloadRequest | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(request);
    };

    const onCaptured = (payload: CapturedBlobPayload) => {
      if (payload.actionId !== actionId) return;
      if (payload.nonce !== nonce) return;
      settle({
        actionId,
        dataUrl: payload.dataUrl,
        safeSignals: payload.safeSignals,
      });
    };

    function onMessage(event: MessageEvent) {
      if (event.source !== view || !isRecord(event.data)) return;
      if (event.data.source !== GSTR2B_CAPTURE_MESSAGE_SOURCE) return;
      if (event.data.type === "ack" && event.data.actionId === actionId) {
        acked = true;
        return;
      }
      if (event.data.type !== "captured") return;
      if (typeof event.data.dataUrl !== "string") return;
      if (event.data.nonce !== nonce) return;
      onCaptured({
        actionId: String(event.data.actionId ?? ""),
        dataUrl: event.data.dataUrl,
        nonce: String(event.data.nonce ?? ""),
        safeSignals: isStringArray(event.data.safeSignals)
          ? event.data.safeSignals
          : ["gstr2b-portal-blob-captured"],
      });
    }

    view.addEventListener("message", onMessage);
    sameWorldCapture.captured.then(onCaptured).catch(() => undefined);
    requestMainWorldCapture(view, { actionId, controlId, nonce });
  });
}

function installBlobCapture(
  view: Window,
  actionId: string,
  nonce: string,
): {
  captured: Promise<CapturedBlobPayload>;
  restore(): void;
} {
  const browserView = view as Window & typeof globalThis;
  const originalCreateObjectUrl = browserView.URL.createObjectURL;
  const originalClick = browserView.HTMLAnchorElement.prototype.click;
  const originalDispatchEvent = browserView.HTMLAnchorElement.prototype.dispatchEvent;
  const capturedBlobUrls = new Set<string>();
  let restoreCalled = false;
  let resolveCaptured: (payload: CapturedBlobPayload) => void = () => undefined;
  const captured = new Promise<CapturedBlobPayload>((resolve) => {
    resolveCaptured = resolve;
  });

  const captureBlob = (blob: Blob, filename?: string | null) => {
    if (!isCaptureableBlob(blob)) return;
    const reader = new browserView.FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return;
      resolveCaptured({
        actionId,
        dataUrl: reader.result,
        nonce,
        safeSignals: [
          "gstr2b-portal-blob-captured",
          "gstr2b-native-blob-click-suppressed",
          ...(filename ? ["gstr2b-portal-filename-observed"] : []),
        ],
      });
    });
    reader.readAsDataURL(blob);
  };

  const shouldSuppressAnchor = (anchor: HTMLAnchorElement) => {
    if (capturedBlobUrls.has(anchor.href)) return true;
    return anchor.hasAttribute("download") && anchor.href.startsWith("blob:");
  };

  browserView.URL.createObjectURL = function createObjectURL(value: Blob | MediaSource) {
    const blobUrl =
      typeof originalCreateObjectUrl === "function"
        ? originalCreateObjectUrl.call(browserView.URL, value)
        : `blob:pack-gstr2b-capture-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 10)}`;
    if (value instanceof browserView.Blob && isCaptureableBlob(value)) {
      capturedBlobUrls.add(blobUrl);
      captureBlob(value);
    }
    return blobUrl;
  };

  browserView.HTMLAnchorElement.prototype.click = function click() {
    if (shouldSuppressAnchor(this)) {
      return undefined;
    }
    return originalClick.call(this);
  };

  browserView.HTMLAnchorElement.prototype.dispatchEvent = function dispatchEvent(event: Event) {
    if (event.type === "click" && shouldSuppressAnchor(this)) {
      return true;
    }
    return originalDispatchEvent.call(this, event);
  };

  return {
    captured,
    restore() {
      if (restoreCalled) return;
      restoreCalled = true;
      browserView.URL.createObjectURL = originalCreateObjectUrl;
      browserView.HTMLAnchorElement.prototype.click = originalClick;
      browserView.HTMLAnchorElement.prototype.dispatchEvent = originalDispatchEvent;
    },
  };
}

function requestMainWorldCapture(
  view: Window,
  config: { actionId: string; controlId: string; nonce: string },
): void {
  const message: Gstr2bCaptureRequestMessage = {
    actionId: config.actionId,
    controlAttribute: GSTR2B_CAPTURE_CONTROL_ATTRIBUTE,
    controlId: config.controlId,
    maxBytes: GSTR2B_CAPTURE_MAX_BYTES,
    nonce: config.nonce,
    source: GSTR2B_CAPTURE_MESSAGE_SOURCE,
    type: "capture-request",
  };
  view.postMessage(message, "*");
}

function isCaptureableBlob(blob: Blob): boolean {
  return blob.size > 0 && blob.size <= GSTR2B_CAPTURE_MAX_BYTES;
}

function createCaptureToken(view: Window): string {
  const bytes = new Uint8Array(16);
  view.crypto?.getRandomValues?.(bytes);
  if (bytes.some((byte) => byte !== 0)) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isJsdomWindow(view: Window): boolean {
  return view.navigator.userAgent.toLowerCase().includes("jsdom");
}

import {
  GSTR2B_CAPTURE_MESSAGE_SOURCE,
  type Gstr2bCaptureRequestMessage,
} from "../connectors/gst/gstr2b-capture-bridge";

export default defineContentScript({
  matches: ["https://gstr2b.gst.gov.in/*"],
  runAt: "document_start",
  world: "MAIN",
  noScriptStartedPostMessage: true,
  main() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || !isCaptureRequest(event.data)) return;
      capturePortalBlobDownload(event.data);
    });
  },
});

function capturePortalBlobDownload(config: Gstr2bCaptureRequestMessage): void {
  const post = (type: "ack" | "captured", payload: Record<string, unknown> = {}) => {
    window.postMessage(
      {
        source: GSTR2B_CAPTURE_MESSAGE_SOURCE,
        type,
        actionId: config.actionId,
        nonce: config.nonce,
        ...payload,
      },
      "*",
    );
  };

  const originalCreateObjectUrl = URL.createObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  const originalDispatchEvent = HTMLAnchorElement.prototype.dispatchEvent;
  const capturedBlobUrls = new Set<string>();
  let captured = false;
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    URL.createObjectURL = originalCreateObjectUrl;
    HTMLAnchorElement.prototype.click = originalClick;
    HTMLAnchorElement.prototype.dispatchEvent = originalDispatchEvent;
  };

  const readBlob = (blob: Blob, filename?: string | null) => {
    if (captured) return;
    if (!blob.size || blob.size > config.maxBytes) return;
    captured = true;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        post("captured", {
          dataUrl: reader.result,
          safeSignals: [
            "gstr2b-portal-blob-captured",
            "gstr2b-native-blob-click-suppressed",
            "gstr2b-main-world-capture",
            ...(filename ? ["gstr2b-portal-filename-observed"] : []),
          ],
        });
      }
      restore();
    });
    reader.readAsDataURL(blob);
  };

  const shouldSuppressAnchor = (anchor: HTMLAnchorElement) => {
    if (capturedBlobUrls.has(anchor.href)) return true;
    return anchor.hasAttribute("download") && anchor.href.startsWith("blob:");
  };

  URL.createObjectURL = function createObjectURL(value: Blob | MediaSource) {
    const blobUrl = originalCreateObjectUrl.call(URL, value);
    if (value instanceof Blob && value.size > 0 && value.size <= config.maxBytes) {
      capturedBlobUrls.add(blobUrl);
      readBlob(value);
    }
    return blobUrl;
  };

  HTMLAnchorElement.prototype.click = function click() {
    if (shouldSuppressAnchor(this)) return undefined;
    return originalClick.call(this);
  };

  HTMLAnchorElement.prototype.dispatchEvent = function dispatchEvent(event: Event) {
    if (event.type === "click" && shouldSuppressAnchor(this)) return true;
    return originalDispatchEvent.call(this, event);
  };

  post("ack");
  document
    .querySelector<HTMLElement>(`[${config.controlAttribute}="${config.controlId}"]`)
    ?.click();
  window.setTimeout(restore, 15_000);
}

function isCaptureRequest(value: unknown): value is Gstr2bCaptureRequestMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.source === GSTR2B_CAPTURE_MESSAGE_SOURCE &&
    record.type === "capture-request" &&
    typeof record.actionId === "string" &&
    typeof record.controlAttribute === "string" &&
    typeof record.controlId === "string" &&
    typeof record.maxBytes === "number" &&
    typeof record.nonce === "string"
  );
}

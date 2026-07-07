import { browser } from "wxt/browser";
import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsMainWorldCaptureRequest,
} from "../core/contracts";

export async function capturePortalBlobDownloadInMainWorld(
  tabId: number,
  request: FiledReturnsMainWorldCaptureRequest,
): Promise<FiledReturnsCapturedDownloadRequest | null> {
  try {
    const [injectionResult] = await browser.scripting.executeScript({
      args: [request],
      func: capturePortalBlobDownload,
      target: { tabId },
      world: "MAIN",
    });
    return isCapturedDownloadRequest(injectionResult?.result) ? injectionResult.result : null;
  } catch {
    return null;
  }
}

function isCapturedDownloadRequest(value: unknown): value is FiledReturnsCapturedDownloadRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.actionId === "string" &&
    typeof record.dataUrl === "string" &&
    Array.isArray(record.safeSignals) &&
    record.safeSignals.every((signal) => typeof signal === "string")
  );
}

async function capturePortalBlobDownload(
  config: FiledReturnsMainWorldCaptureRequest,
): Promise<FiledReturnsCapturedDownloadRequest | null> {
  return new Promise((resolve) => {
    const escapeCss = (value: string) => {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
      }
      return value.replace(/["\\]/g, "\\$&");
    };
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalDispatchEvent = HTMLAnchorElement.prototype.dispatchEvent;
    const capturedBlobUrls = new Set<string>();
    let restored = false;
    let settled = false;

    const restore = () => {
      if (restored) return;
      restored = true;
      URL.createObjectURL = originalCreateObjectUrl;
      HTMLAnchorElement.prototype.click = originalClick;
      HTMLAnchorElement.prototype.dispatchEvent = originalDispatchEvent;
      document
        .querySelector<HTMLElement>(`[${config.controlAttribute}="${escapeCss(config.controlId)}"]`)
        ?.removeAttribute(config.controlAttribute);
    };

    const settle = (request: FiledReturnsCapturedDownloadRequest | null) => {
      if (settled) return;
      settled = true;
      restore();
      resolve(request);
    };

    const readBlob = (blob: Blob, filename?: string | null) => {
      if (settled) return;
      if (!blob.size || blob.size > config.maxBytes) return;
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result !== "string") {
          settle(null);
          return;
        }
        settle({
          actionId: config.actionId,
          dataUrl: reader.result,
          safeSignals: [
            `${config.signalPrefix}-portal-blob-captured`,
            `${config.signalPrefix}-native-blob-click-suppressed`,
            `${config.signalPrefix}-main-world-capture`,
            ...(filename ? [`${config.signalPrefix}-portal-filename-observed`] : []),
          ],
        });
      });
      reader.addEventListener("error", () => settle(null));
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

    document
      .querySelector<HTMLElement>(`[${config.controlAttribute}="${escapeCss(config.controlId)}"]`)
      ?.click();
    window.setTimeout(() => settle(null), 15_000);
  });
}

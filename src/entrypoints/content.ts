import { browser } from "wxt/browser";
import { detectGstPortalContext } from "../connectors/gst/detect";
import { runFiledReturnsDownloadStep } from "../connectors/gst/filed-returns-flow";
import { triggerFiledReturnDownload } from "../connectors/gst/filed-returns-download";
import { triggerGstr2bDownload } from "../connectors/gst/gstr2b-download";
import { resolveFiledGstr3bVerifiedPdfDownloadRequest } from "../connectors/gst/filed-returns-direct-download-probe";
import { navigateToFiledReturnsPage } from "../connectors/gst/filed-returns-navigator";
import { observeFiledReturnsPageText } from "../connectors/gst/filed-returns-observer";
import {
  PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
  isPackMessage,
  type MainWorldCaptureTransferPayload,
  type PackMessageResponse,
} from "../core/messages";

const PACK_CONTENT_LISTENER_KEY = `__packContentListenerInstalledV${PACK_CONTENT_SCRIPT_PROTOCOL_VERSION}`;
const PACK_ACTIVE_CONTENT_PROTOCOL_KEY = "__packActiveContentProtocolVersion";
const PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE = "pack-main-world-capture-v1";
const PACK_MAIN_WORLD_CAPTURE_MAX_CHUNKS = 200;

declare global {
  interface Window {
    [PACK_ACTIVE_CONTENT_PROTOCOL_KEY]?: number;
    [PACK_CONTENT_LISTENER_KEY]?: boolean;
  }
}

interface MainWorldCaptureTransfer {
  actionId: string;
  chunks: string[];
  transferId: string;
}

export default defineContentScript({
  matches: [
    "https://www.gst.gov.in/*",
    "https://services.gst.gov.in/*",
    "https://return.gst.gov.in/*",
    "https://gstr2b.gst.gov.in/*",
  ],
  runAt: "document_idle",
  main() {
    window[PACK_ACTIVE_CONTENT_PROTOCOL_KEY] = PACK_CONTENT_SCRIPT_PROTOCOL_VERSION;
    if (window[PACK_CONTENT_LISTENER_KEY]) return;
    window[PACK_CONTENT_LISTENER_KEY] = true;
    const mainWorldCaptureTransfers = new Map<string, MainWorldCaptureTransfer>();

    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.source !== window || !isMainWorldCaptureChunkMessage(event.data)) return;
      const key = mainWorldCaptureTransferKey(event.data);
      const transfer = mainWorldCaptureTransfers.get(key);
      if (!transfer || transfer.actionId !== event.data.actionId) return;
      if (event.data.index >= event.data.totalChunks) return;
      if (event.data.totalChunks > PACK_MAIN_WORLD_CAPTURE_MAX_CHUNKS) return;
      transfer.chunks[event.data.index] = event.data.chunk;
    });

    const context = detectGstPortalContext(window.location, document.title);
    void browser.runtime
      .sendMessage({
        type: "PACK_CONTENT_CONTEXT",
        payload: context,
      })
      .catch(() => {
        // Service workers can be unavailable during extension reload.
      });

    if (context.pageKind === "gst-filed-returns") {
      sendFiledReturnsObservation();
    }

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (window[PACK_ACTIVE_CONTENT_PROTOCOL_KEY] !== PACK_CONTENT_SCRIPT_PROTOCOL_VERSION) {
        return false;
      }

      if (!isPackMessage(message)) {
        return false;
      }

      if (message.type === "PACK_CONTENT_PING_V2") {
        sendResponse({
          ok: true,
          context: null,
          contentScriptVersion: PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
        } satisfies PackMessageResponse);
        return false;
      }

      if (message.type === "PACK_CONTENT_REFRESH_CONTEXT_V3") {
        const refreshedContext = detectGstPortalContext(window.location, document.title);
        void browser.runtime
          .sendMessage({
            type: "PACK_CONTENT_CONTEXT",
            payload: refreshedContext,
          })
          .catch(() => {
            // Service workers can be unavailable during extension reload.
          });
        sendResponse({
          ok: true,
          context: refreshedContext,
          contentScriptVersion: PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
        } satisfies PackMessageResponse);
        return false;
      }

      if (message.type === "PACK_CONTENT_NAVIGATE_FILED_RETURNS_V3") {
        void navigateToFiledReturnsPage(document)
          .then((navigation) =>
            sendResponse({ ok: true, navigation } satisfies PackMessageResponse),
          )
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : "Filed returns navigation failed.",
            } satisfies PackMessageResponse),
          );
        return true;
      }

      if (message.type === "PACK_CONTENT_REFRESH_FILED_RETURNS_OBSERVATION_V3") {
        const observation = sendFiledReturnsObservation();
        sendResponse({
          ok: true,
          observation,
        } satisfies PackMessageResponse);
        return false;
      }

      if (message.type === "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3") {
        if (message.payload.returnType === "GSTR-2B") {
          void triggerGstr2bDownload(document, message.payload)
            .then(({ capturedDownloadRequest, mainWorldCaptureRequest, downloadTrigger }) => {
              const observation = sendFiledReturnsObservation();
              if (capturedDownloadRequest) {
                sendResponse({
                  ok: true,
                  capturedDownloadRequest,
                  downloadTrigger,
                  observation,
                } satisfies PackMessageResponse);
                return;
              }
              if (mainWorldCaptureRequest) {
                sendResponse({
                  ok: true,
                  mainWorldCaptureRequest,
                  downloadTrigger,
                  observation,
                } satisfies PackMessageResponse);
                return;
              }
              sendResponse({
                ok: true,
                downloadTrigger,
                observation,
              } satisfies PackMessageResponse);
            })
            .catch((error: unknown) =>
              sendResponse({
                ok: false,
                error:
                  error instanceof Error ? error.message : "Filed return download trigger failed.",
              } satisfies PackMessageResponse),
            );
          return true;
        }

        void triggerFiledReturnDownload(document, message.payload)
          .then(({ mainWorldCaptureRequest, downloadTrigger }) => {
            const observation = sendFiledReturnsObservation();
            if (mainWorldCaptureRequest) {
              sendResponse({
                ok: true,
                mainWorldCaptureRequest,
                downloadTrigger,
                observation,
              } satisfies PackMessageResponse);
              return;
            }
            sendResponse({
              ok: true,
              downloadTrigger,
              observation,
            } satisfies PackMessageResponse);
          })
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error:
                error instanceof Error ? error.message : "Filed return download trigger failed.",
            } satisfies PackMessageResponse),
          );
        return true;
      }

      if (message.type === "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3") {
        void resolveFiledGstr3bVerifiedPdfDownloadRequest(document, message.payload)
          .then((resolved) => {
            const observation = sendFiledReturnsObservation();
            if (!resolved.ok) {
              sendResponse({
                ok: true,
                downloadTrigger: resolved.result,
                observation,
              } satisfies PackMessageResponse);
              return;
            }

            sendResponse({
              ok: true,
              directDownloadRequest: {
                actionId: message.payload.actionId,
                url: new URL(resolved.pdfPath, window.location.origin).href,
                safeSignals: resolved.safeSignals,
              },
              observation,
            } satisfies PackMessageResponse);
          })
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Filed GSTR-3B direct download resolution failed.",
            } satisfies PackMessageResponse),
          );
        return true;
      }

      if (message.type === "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3") {
        void runFiledReturnsDownloadStep(document, message.payload)
          .then((flowStep) => {
            const observation = sendFiledReturnsObservation();
            sendResponse({
              ok: true,
              flowStep,
              observation,
            } satisfies PackMessageResponse);
          })
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error:
                error instanceof Error ? error.message : "Filed returns download flow step failed.",
            } satisfies PackMessageResponse),
          );
        return true;
      }

      if (message.type === "PACK_CONTENT_PREPARE_MAIN_WORLD_CAPTURE_V3") {
        mainWorldCaptureTransfers.set(mainWorldCaptureTransferKey(message.payload), {
          actionId: message.payload.actionId,
          chunks: [],
          transferId: message.payload.transferId,
        });
        sendResponse({
          ok: true,
          mainWorldCapturePrepared: true,
        } satisfies PackMessageResponse);
        return false;
      }

      if (message.type === "PACK_CONTENT_TAKE_MAIN_WORLD_CAPTURE_CHUNK_V3") {
        const transfer = mainWorldCaptureTransfers.get(mainWorldCaptureTransferKey(message.payload));
        const chunk = transfer?.chunks[message.payload.index];
        if (typeof chunk !== "string") {
          sendResponse({
            ok: false,
            error: "Pack could not read the captured filed-return chunk.",
          } satisfies PackMessageResponse);
          return false;
        }
        sendResponse({
          ok: true,
          mainWorldCaptureChunk: chunk,
        } satisfies PackMessageResponse);
        return false;
      }

      if (message.type === "PACK_CONTENT_CLEAR_MAIN_WORLD_CAPTURE_V3") {
        mainWorldCaptureTransfers.delete(mainWorldCaptureTransferKey(message.payload));
        sendResponse({
          ok: true,
          mainWorldCaptureCleared: true,
        } satisfies PackMessageResponse);
        return false;
      }

      return false;
    });
  },
});

function sendFiledReturnsObservation() {
  const observation = observeFiledReturnsPageText(document.body.innerText, {
    pathname: window.location.pathname,
  });

  void browser.runtime
    .sendMessage({
      type: "PACK_FILED_RETURNS_OBSERVATION",
      payload: observation,
    })
    .catch(() => {
      // Service workers can be unavailable during extension reload.
    });
  return observation;
}

function mainWorldCaptureTransferKey(payload: MainWorldCaptureTransferPayload): string {
  return `${payload.actionId}:${payload.transferId}`;
}

function isMainWorldCaptureChunkMessage(input: unknown): input is {
  actionId: string;
  chunk: string;
  index: number;
  source: typeof PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE;
  totalChunks: number;
  transferId: string;
} {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return (
    record.source === PACK_MAIN_WORLD_CAPTURE_MESSAGE_SOURCE &&
    typeof record.actionId === "string" &&
    typeof record.transferId === "string" &&
    typeof record.chunk === "string" &&
    typeof record.index === "number" &&
    Number.isInteger(record.index) &&
    record.index >= 0 &&
    typeof record.totalChunks === "number" &&
    Number.isInteger(record.totalChunks) &&
    record.totalChunks > 0 &&
    record.totalChunks <= PACK_MAIN_WORLD_CAPTURE_MAX_CHUNKS
  );
}

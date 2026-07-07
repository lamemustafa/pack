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
  type PackMessageResponse,
} from "../core/messages";

const PACK_CONTENT_LISTENER_KEY = `__packContentListenerInstalledV${PACK_CONTENT_SCRIPT_PROTOCOL_VERSION}`;

declare global {
  interface Window {
    [PACK_CONTENT_LISTENER_KEY]?: boolean;
  }
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
    if (window[PACK_CONTENT_LISTENER_KEY]) return;
    window[PACK_CONTENT_LISTENER_KEY] = true;

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

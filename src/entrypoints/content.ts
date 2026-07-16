import { browser } from "wxt/browser";
import { detectGstPortalContext } from "../connectors/gst/detect";
import { runFiledReturnsDownloadStep } from "../connectors/gst/filed-returns-flow";
import { triggerFiledReturnDownload } from "../connectors/gst/filed-returns-download";
import { resolveFiledGstr3bVerifiedPdfDownloadRequest } from "../connectors/gst/filed-returns-direct-download-probe";
import { navigateToFiledReturnsPage } from "../connectors/gst/filed-returns-navigator";
import { observeFiledReturnsPageText } from "../connectors/gst/filed-returns-observer";
import { detectPostClickBlockedState } from "../connectors/gst/filed-returns-post-click-blocked-state";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import {
  clearFiledReturnsSearchAttemptForScope,
  markGstr1ViewActivationAttempted,
  markFiledReturnsSearchPending,
} from "../connectors/gst/filed-returns-search-state";
import { resolveGstr1FiledReturnViewPoint } from "../connectors/gst/filed-returns-result-row-navigation";
import {
  PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
  isPackMessage,
  type PackMessageResponse,
} from "../core/messages";

const PACK_CONTENT_LISTENER_KEY = `__packContentListenerInstalledV${PACK_CONTENT_SCRIPT_PROTOCOL_VERSION}`;
const PACK_ACTIVE_CONTENT_PROTOCOL_KEY = "__packActiveContentProtocolVersion";

declare global {
  interface Window {
    [PACK_ACTIVE_CONTENT_PROTOCOL_KEY]?: number;
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
    window[PACK_ACTIVE_CONTENT_PROTOCOL_KEY] = PACK_CONTENT_SCRIPT_PROTOCOL_VERSION;
    if (window[PACK_CONTENT_LISTENER_KEY]) return;
    window[PACK_CONTENT_LISTENER_KEY] = true;

    const context = detectGstPortalContext(
      window.location,
      document.title,
      document.body?.innerText ?? "",
    );
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
        const refreshedContext = detectGstPortalContext(
          window.location,
          document.title,
          document.body?.innerText ?? "",
        );
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

      if (message.type === "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3") {
        const flowStep = detectPostClickBlockedState(document, message.payload, []);
        sendResponse({
          ok: true,
          flowStep: flowStep ?? {
            connectorId: "gst",
            scopeId: filedReturnScopeId(message.payload.returnType),
            state: "candidate-not-found",
            safeSignals: ["filed-return-post-click-blocked-state-not-found"],
            safeMessage: "Pack did not find a recognized post-click portal block.",
          },
        } satisfies PackMessageResponse);
        return false;
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

      if (message.type === "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3") {
        markFiledReturnsSearchPending(document, message.payload);
        sendResponse({
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: filedReturnScopeId(message.payload.returnType),
            state: "clicked",
            safeSignals: ["filed-return-search-pending-marked"],
            safeMessage: "Pack prepared target-bound filed-return search tracking.",
          },
        } satisfies PackMessageResponse);
        return false;
      }

      if (message.type === "PACK_CONTENT_CLEAR_FILED_RETURNS_SEARCH_PENDING_V3") {
        clearFiledReturnsSearchAttemptForScope(document, message.payload);
        sendResponse({
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: filedReturnScopeId(message.payload.returnType),
            state: "clicked",
            safeSignals: ["filed-return-search-pending-cleared"],
            safeMessage: "Pack cleared an unsubmitted filed-return search attempt.",
          },
        } satisfies PackMessageResponse);
        return false;
      }

      if (message.type === "PACK_CONTENT_RESOLVE_GSTR1_VIEW_POINT_V3") {
        void resolveGstr1FiledReturnViewPoint(document, message.payload)
          .then((resolution) => {
            if (!resolution.ok) {
              sendResponse({
                ok: true,
                flowStep: resolution.flowStep,
              } satisfies PackMessageResponse);
              return;
            }
            sendResponse({
              ok: true,
              gstr1ViewPoint: resolution.point,
            } satisfies PackMessageResponse);
          })
          .catch(() =>
            sendResponse({
              ok: false,
              error: "GSTR-1_VIEW_POINT_UNAVAILABLE",
            } satisfies PackMessageResponse),
          );
        return true;
      }

      if (message.type === "PACK_CONTENT_MARK_GSTR1_VIEW_ACTIVATION_V3") {
        markGstr1ViewActivationAttempted(document, message.payload);
        sendResponse({
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: filedReturnScopeId("GSTR-1"),
            state: "clicked",
            safeSignals: ["filed-gstr1-result-view-navigation-pending"],
            safeMessage: "Pack marked the exact GSTR-1 View action as navigation-pending.",
          },
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

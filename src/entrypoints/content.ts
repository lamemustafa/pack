import { browser } from "wxt/browser";
import { detectGstPortalContext } from "../connectors/gst/detect";
import { runFiledReturnsDownloadStep } from "../connectors/gst/filed-returns-flow";
import { triggerFiledGstr3bFiledPdfDownload } from "../connectors/gst/filed-returns-download";
import {
  dismissKnownFiledReturnsSummaryModal,
  navigateToFiledReturnsPage,
} from "../connectors/gst/filed-returns-navigator";
import { observeFiledReturnsPageText } from "../connectors/gst/filed-returns-observer";
import { isPackMessage, type PackMessageResponse } from "../core/messages";

const PACK_CONTENT_LISTENER_KEY = "__packContentListenerInstalled";

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

      if (message.type === "PACK_PING") {
        sendResponse({ ok: true, context: null } satisfies PackMessageResponse);
        return false;
      }

      if (message.type === "PACK_NAVIGATE_FILED_RETURNS") {
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

      if (message.type === "PACK_REFRESH_FILED_RETURNS_OBSERVATION") {
        void dismissKnownFiledReturnsSummaryModal(document)
          .then(() => {
            const observation = sendFiledReturnsObservation();
            sendResponse({
              ok: true,
              observation,
            } satisfies PackMessageResponse);
          })
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Filed returns observation refresh failed.",
            } satisfies PackMessageResponse),
          );
        return true;
      }

      if (message.type === "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD") {
        void triggerFiledGstr3bFiledPdfDownload(document)
          .then((downloadTrigger) => {
            const observation = sendFiledReturnsObservation();
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
                error instanceof Error ? error.message : "Filed GSTR-3B download trigger failed.",
            } satisfies PackMessageResponse),
          );
        return true;
      }

      if (message.type === "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP") {
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

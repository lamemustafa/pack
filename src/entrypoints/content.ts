import { browser } from "wxt/browser";
import { detectGstPortalContext } from "../connectors/gst/detect";
import { runFiledReturnsDownloadStep } from "../connectors/gst/filed-returns-flow";
import { triggerFiledGstr3bFiledPdfDownload } from "../connectors/gst/filed-returns-download";
import {
  dismissKnownFiledReturnsSummaryModal,
  navigateToFiledReturnsPage,
} from "../connectors/gst/filed-returns-navigator";
import { observeFiledReturnsPageText } from "../connectors/gst/filed-returns-observer";
import { createSafeRequestShapes } from "../connectors/gst/request-shape-observer";
import { isPackMessage, type PackMessageResponse } from "../core/messages";

const REQUEST_SHAPE_SAMPLE_COUNT = 20;
const REQUEST_SHAPE_SAMPLE_INTERVAL_MS = 1_500;

export default defineContentScript({
  matches: [
    "https://www.gst.gov.in/*",
    "https://services.gst.gov.in/*",
    "https://return.gst.gov.in/*",
  ],
  runAt: "document_idle",
  main() {
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
      startFiledReturnsRequestShapeSampling();
    }

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isPackMessage(message)) {
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
            const requestShapes = getFiledReturnsRequestShapes();
            const observation = sendFiledReturnsObservation(requestShapes);
            sendResponse({
              ok: true,
              observation,
              requestShapes,
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
            const requestShapes = getFiledReturnsRequestShapes();
            const observation = sendFiledReturnsObservation(requestShapes);
            sendResponse({
              ok: true,
              downloadTrigger,
              observation,
              requestShapes,
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
            const requestShapes = getFiledReturnsRequestShapes();
            const observation = sendFiledReturnsObservation(requestShapes);
            sendResponse({
              ok: true,
              flowStep,
              observation,
              requestShapes,
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

function sendFiledReturnsObservation(requestShapes = getFiledReturnsRequestShapes()) {
  const observation = observeFiledReturnsPageText(document.body.innerText, {
    pathname: window.location.pathname,
    requestPathShapes: requestShapes.map((shape) => shape.pathShape),
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

function startFiledReturnsRequestShapeSampling() {
  let remaining = REQUEST_SHAPE_SAMPLE_COUNT;
  const send = () => {
    const requestShapes = getFiledReturnsRequestShapes();

    if (requestShapes.length > 0) {
      void browser.runtime
        .sendMessage({
          type: "PACK_FILED_RETURNS_REQUEST_SHAPES",
          payload: requestShapes,
        })
        .catch(() => {
          // Service workers can be unavailable during extension reload.
        });
    }
    sendFiledReturnsObservation();
  };

  send();
  const timer = window.setInterval(() => {
    remaining -= 1;
    send();
    if (remaining <= 0) window.clearInterval(timer);
  }, REQUEST_SHAPE_SAMPLE_INTERVAL_MS);
}

function getFiledReturnsRequestShapes() {
  return createSafeRequestShapes(
    performance.getEntriesByType("resource").map((entry) => {
      const resourceEntry = entry as PerformanceResourceTiming;
      return {
        name: entry.name,
        initiatorType: resourceEntry.initiatorType,
        startTime: entry.startTime,
      };
    }),
    window.location.origin,
  );
}

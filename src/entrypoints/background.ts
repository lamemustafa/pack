import { browser } from "wxt/browser";
import type { ArchiveManifest } from "../core/contracts";
import { PACK_PRODUCT_VERSION } from "../extension/version";
import { isPackMessage, type PackMessageResponse } from "../connectors/gst/messages";
import { isPackOffscreenBlobUrlMessage } from "../connectors/gst/filed-returns-offscreen-validation";
import {
  acknowledgeInterruptedFiledReturnsRun,
  readActiveFiledReturnsRunSummary,
} from "../background/filed-returns-active-run";
import { readCurrentFiledReturnsFlowSummary } from "../background/filed-returns-current-state";
import {
  reconcilePendingFullFiscalYearZipDownload,
  reconcilePersistedFullFiscalYearZipDownload,
} from "../background/filed-returns-full-fiscal-year";
import {
  resolveFullFiscalYearTargetFlow,
  resolveUnconfirmedFiledReturnsDownloadFlow,
  retryFullFiscalYearTargetDownloadFlow,
  retryFiledReturnsTargetDownloadFlow,
  startFreshFiledReturnsDownloadFlow,
  startFiledReturnsDownloadFlow,
} from "../background/filed-returns-flow-runner";
import { clearPackLocalDataWithRecoveryGuard } from "../background/local-data";
import { startSyntheticDemo } from "../background/synthetic-demo";
import { runDownloadPromptProbe } from "../background/download-prompt-probe";
import { selectFiledReturnsFiltersInMainWorldForTab } from "../background/main-world-filed-returns-filter-executor";
import {
  PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
  PACK_LOCAL_STORAGE_KEYS,
  PACK_SESSION_STORAGE_KEYS,
  filedReturnsStorageKeys,
} from "../background/storage-keys";
import {
  getActiveGstTab,
  inferActiveFiledReturnsObservation,
  isSupportedGstBrowserTab,
  refreshActiveFiledReturnsObservation,
  refreshActiveGstContext,
  rememberActiveGstTabById,
  rememberGstTabIfSupported,
  sendMessageToTabWithInjection,
} from "../background/gst-tab-context";
import {
  parseCanonicalFiledReturnsObservation,
  persistCanonicalFiledReturnsObservation,
  readCanonicalFiledReturnsObservation,
} from "../background/filed-returns-observation-state";
import {
  parseCanonicalGstPortalContext,
  persistCanonicalGstPortalContext,
} from "../background/gst-context-state";
import {
  installFiledReturnsDurableDownloadReconciler,
  reconcileTerminalFiledReturnsDownload,
} from "../background/filed-returns-durable-download-reconciler";
import { installPackDownloadFilenameReassertion } from "../background/pack-download-filename-reassertion";

export {
  PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
  PACK_LOCAL_STORAGE_KEYS,
  PACK_SESSION_STORAGE_KEYS,
  filedReturnsStorageKeys,
} from "../background/storage-keys";
export {
  getActiveGstTab,
  isCurrentContentScriptPingResponse,
  rememberActiveGstTabById,
  rememberGstTabIfSupported,
  sendMessageToTabWithInjection,
} from "../background/gst-tab-context";

const OFFICIAL_URL = "https://pack.complyeaze.com";

/**
 * Clicking the toolbar icon opens the side panel.
 *
 * The panel is the surface a run can be watched from, and it is the only one
 * that survives the run itself: `getRequiredGstTab` focuses the GST tab and its
 * window when a run starts, which pushes any tab-hosted surface behind the page
 * being driven, and a popup closes outright the moment focus leaves it.
 *
 * `setPanelBehavior` is what makes the action's click open the panel, and it is
 * guarded rather than awaited at module scope: a browser without the API, or a
 * failure here, must not take the rest of the service worker down with it. The
 * manifest's `side_panel.default_path` still resolves the panel in that case,
 * so the surface remains reachable from the browser's own side-panel control.
 */
function installPackActionOpensSidePanel() {
  const sidePanel = (
    browser as unknown as {
      sidePanel?: {
        setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
      };
    }
  ).sidePanel;
  // Registered SYNCHRONOUSLY during worker start-up, not from the rejection
  // handler. An action click can wake a suspended worker and be dispatched
  // before an async rejection lands, so a listener installed inside `.catch`
  // misses the very click that started the worker -- and the popup is gone, so
  // that click does nothing at all.
  let sidePanelArmed = false;
  browser.action?.onClicked?.addListener?.(() => {
    if (sidePanelArmed) return;
    void browser.tabs.create({ url: browser.runtime.getURL("/panel.html") }).catch(() => undefined);
  });
  void sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .then(() => {
      sidePanelArmed = true;
    })
    .catch(() => undefined);
}

export default defineBackground(() => {
  void restrictLocalStorageToTrustedContexts().catch(() => undefined);
  installPackActionOpensSidePanel();
  installFiledReturnsDurableDownloadReconciler(undefined, {
    storageKeys: filedReturnsStorageKeys(),
    reconcileFullFiscalYearZip: (downloadId) =>
      reconcilePendingFullFiscalYearZipDownload(downloadId, filedReturnsFlowRunnerDeps()),
    reconcilePersistedFullFiscalYearZip: () =>
      reconcilePersistedFullFiscalYearZipDownload(filedReturnsFlowRunnerDeps()),
  });
  installPackDownloadFilenameReassertion();

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void rememberActiveGstTabById(tabId).catch(() => undefined);
  });

  browser.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => {
    void rememberGstTabIfSupported(tab).catch(() => undefined);
  });

  browser.runtime.onInstalled.addListener(() => {
    void browser.storage.local.set({
      [PACK_LOCAL_STORAGE_KEYS.install]: {
        version: packRuntimeVersion(),
        installedAt: new Date().toISOString(),
        localOnly: true,
      },
    });
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // runtime.sendMessage broadcasts within the extension. The offscreen document
    // owns this validated local protocol, so the background must not race its reply.
    if (isPackOffscreenBlobUrlMessage(message)) return false;

    void handleMessage(message, sender)
      .then((response) => sendResponse(response))
      .catch(() =>
        sendResponse({
          ok: false,
          error: "BACKGROUND_MESSAGE_HANDLER_FAILED",
          safeMessage: `Pack stopped while handling ${backgroundMessageSource(message)}. Try the action again.`,
          safeSite: backgroundMessageHandlerSite(message),
        } satisfies PackMessageResponse),
      );
    return true;
  });
});

function backgroundMessageSource(message: unknown): string {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return "an extension request";
  }
  switch (message.type) {
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
    case "PACK_START_FRESH_FILED_RETURNS_DOWNLOAD_FLOW":
    case "PACK_RETRY_FILED_RETURNS_TARGET":
    case "PACK_RETRY_FULL_FISCAL_YEAR_TARGET":
      return "a filed-returns download request";
    case "PACK_START_SYNTHETIC_DEMO":
      return "the synthetic reviewer demo";
    case "PACK_RUN_DOWNLOAD_PROMPT_PROBE":
      return "the download prompt probe";
    case "PACK_GET_LAST_MANIFEST":
      return "the local manifest request";
    case "PACK_CLEAR_LOCAL_DATA":
      return "the local data cleanup request";
    default:
      return "an extension request";
  }
}

function backgroundMessageHandlerSite(message: unknown): `background-message-handler:${string}` {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return "background-message-handler:invalid-message";
  }
  switch (message.type) {
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
      return "background-message-handler:filed-returns-start";
    case "PACK_START_FRESH_FILED_RETURNS_DOWNLOAD_FLOW":
      return "background-message-handler:filed-returns-start-fresh";
    case "PACK_RETRY_FILED_RETURNS_TARGET":
      return "background-message-handler:filed-returns-retry";
    case "PACK_RETRY_FULL_FISCAL_YEAR_TARGET":
      return "background-message-handler:full-fiscal-year-retry";
    case "PACK_START_SYNTHETIC_DEMO":
      return "background-message-handler:synthetic-demo";
    case "PACK_RUN_DOWNLOAD_PROMPT_PROBE":
      return "background-message-handler:download-prompt-probe";
    case "PACK_GET_LAST_MANIFEST":
      return "background-message-handler:last-manifest";
    case "PACK_CLEAR_LOCAL_DATA":
      return "background-message-handler:local-data-clear";
    default:
      return "background-message-handler:extension-request";
  }
}

export async function restrictLocalStorageToTrustedContexts(): Promise<void> {
  const storageArea = browser.storage.local as typeof browser.storage.local & {
    setAccessLevel?: (options: { accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void> | void;
  };
  await storageArea.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
}

async function handleMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
): Promise<PackMessageResponse> {
  if (
    !isPackMessage(message, {
      portalContext: (input) => parseCanonicalGstPortalContext(input, sender.tab?.url) !== null,
      portalObservation: (input) => parseCanonicalFiledReturnsObservation(input) !== null,
    })
  ) {
    if (sender.id === browser.runtime.id && isSupportedGstBrowserTab(sender.tab)) {
      if (isFiledReturnsObservationEnvelope(message)) {
        await browser.storage.session.remove(PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation);
      }
      if (isContentContextEnvelope(message)) {
        await browser.storage.session.remove(PACK_SESSION_STORAGE_KEYS.lastContext);
      }
    }
    return { ok: false, error: "Unsupported Pack message." };
  }

  switch (message.type) {
    case "PACK_CONTENT_CONTEXT": {
      if (sender.id !== browser.runtime.id || !isSupportedGstBrowserTab(sender.tab)) {
        return { ok: false, error: "Invalid Pack sender or context." };
      }
      const context = await persistCanonicalGstPortalContext(
        PACK_SESSION_STORAGE_KEYS.lastContext,
        message.payload,
        sender.tab.url,
      );
      if (!context) return { ok: false, error: "Invalid Pack sender or context." };
      const nextSessionValues: Record<string, unknown> = {
        [PACK_SESSION_STORAGE_KEYS.lastGstTabId]: sender.tab.id,
      };
      await browser.storage.session.set({
        ...nextSessionValues,
      });
      return { ok: true, context };
    }
    case "PACK_FILED_RETURNS_OBSERVATION": {
      if (sender.id !== browser.runtime.id || !isSupportedGstBrowserTab(sender.tab)) {
        return { ok: false, error: "Invalid Pack sender." };
      }
      const observation = await persistCanonicalFiledReturnsObservation(
        PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation,
        message.payload,
      );
      return observation
        ? { ok: true, observation }
        : { ok: false, error: "Invalid Pack observation." };
    }
    case "PACK_GET_CONTEXT":
      return {
        ok: true,
        context: await refreshActiveGstContext(),
      };
    case "PACK_GET_FILED_RETURNS_OBSERVATION": {
      const refreshedObservation = await refreshActiveFiledReturnsObservation();
      return {
        ok: true,
        observation:
          refreshedObservation ??
          (await inferActiveFiledReturnsObservation()) ??
          (await readCanonicalFiledReturnsObservation(
            PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation,
          )),
      };
    }
    case "PACK_GET_FILED_RETURNS_FLOW_SUMMARY":
      await reconcileTerminalFiledReturnsDownload(browser.downloads, {
        storageKeys: filedReturnsStorageKeys(),
      }).catch(() => undefined);
      return {
        ok: true,
        flowSummary: await readCurrentFiledReturnsFlowSummary({
          storageKeys: filedReturnsStorageKeys(),
        }),
      };
    case "PACK_GET_ACTIVE_FILED_RETURNS_RUN":
      return {
        ok: true,
        flowSummary: await readActiveFiledReturnsRunSummary({
          storageKeys: { activeRun: PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun },
        }),
      };
    case "PACK_ACKNOWLEDGE_INTERRUPTED_RUN":
      return acknowledgeInterruptedFiledReturnsRun({
        storageKeys: { activeRun: PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun },
      });
    case "PACK_RETRY_FILED_RETURNS_TARGET":
      return retryFiledReturnsTargetDownloadFlow(message.payload, filedReturnsFlowRunnerDeps());
    case "PACK_RETRY_FULL_FISCAL_YEAR_TARGET":
      return retryFullFiscalYearTargetDownloadFlow(message.payload, filedReturnsFlowRunnerDeps());
    case "PACK_RESOLVE_UNCONFIRMED_DOWNLOAD":
      return resolveUnconfirmedFiledReturnsDownloadFlow(
        message.payload.scope,
        message.payload.resolution,
        filedReturnsFlowRunnerDeps(),
      );
    case "PACK_RESOLVE_FULL_FISCAL_YEAR_TARGET":
      return resolveFullFiscalYearTargetFlow(
        message.payload,
        message.payload.resolution,
        filedReturnsFlowRunnerDeps(),
      );
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
      return startFiledReturnsDownloadFlow(message.payload, filedReturnsFlowRunnerDeps());
    case "PACK_START_FRESH_FILED_RETURNS_DOWNLOAD_FLOW":
      return startFreshFiledReturnsDownloadFlow(message.payload, filedReturnsFlowRunnerDeps());
    case "PACK_START_SYNTHETIC_DEMO":
      return startSyntheticDemo({
        productVersion: packRuntimeVersion(),
        officialUrl: OFFICIAL_URL,
        storageKeys: { lastManifest: PACK_LOCAL_STORAGE_KEYS.lastManifest },
        downloadArtifacts: message.payload?.downloadArtifacts === true,
      });
    case "PACK_RUN_DOWNLOAD_PROMPT_PROBE":
      return {
        ok: true,
        downloadPromptProbe: await runDownloadPromptProbe(message.payload?.sourceClass),
      };
    case "PACK_CLEAR_LOCAL_DATA":
      return clearPackLocalData();
    case "PACK_GET_LAST_MANIFEST":
      return {
        ok: true,
        manifest: await readLocalValue<ArchiveManifest>(PACK_LOCAL_STORAGE_KEYS.lastManifest),
      };
  }

  return { ok: false, error: "Unsupported Pack message." };
}

function isFiledReturnsObservationEnvelope(input: unknown): boolean {
  return Boolean(
    input &&
    typeof input === "object" &&
    "type" in input &&
    input.type === "PACK_FILED_RETURNS_OBSERVATION",
  );
}

function isContentContextEnvelope(input: unknown): boolean {
  return Boolean(
    input && typeof input === "object" && "type" in input && input.type === "PACK_CONTENT_CONTEXT",
  );
}

function packRuntimeVersion() {
  return browser.runtime.getManifest().version ?? PACK_PRODUCT_VERSION;
}

function filedReturnsFlowRunnerDeps() {
  return {
    getActiveGstTab,
    selectFiltersInMainWorld: selectFiledReturnsFiltersInMainWorldForTab,
    sendMessageToTabWithInjection,
    storageKeys: filedReturnsStorageKeys(),
  };
}

export async function clearPackLocalData(): Promise<PackMessageResponse> {
  return clearPackLocalDataWithRecoveryGuard({
    clearableLocalStorageKeys: PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    storageKeys: {
      activeRun: PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun,
      fullFiscalYearLedger: PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedger,
      targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
    },
  });
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}

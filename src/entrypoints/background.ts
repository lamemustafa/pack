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
import { readCurrentAllSupportedFullFiscalYearFlowSummary } from "../background/filed-returns-all-supported-full-fiscal-year-summary";
import {
  reconcilePendingAllSupportedFullFiscalYearZipDownload,
  reconcilePersistedAllSupportedFullFiscalYearZipDownload,
} from "../background/filed-returns-all-supported-full-fiscal-year";
import {
  reconcilePendingFullFiscalYearZipDownload,
  reconcilePersistedFullFiscalYearZipDownload,
} from "../background/filed-returns-full-fiscal-year";
import {
  resolveFullFiscalYearTargetFlow,
  resolveUnconfirmedFiledReturnsDownloadFlow,
  retryFullFiscalYearTargetDownloadFlow,
  startAllSupportedFiledReturnsFullFiscalYearDownloadFlow,
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
  isTrustedGstContextReporterTab,
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
  // No tab fallback. It was added to keep the toolbar button alive on a browser
  // without `sidePanel`, but the manifest already requires Chrome 116 and the
  // API landed in 114, so that browser cannot install this extension. The guard
  // covered a case that cannot occur.
  //
  // Worse, it could not be made correct: Chrome retains `openPanelOnActionClick`
  // across a worker suspension while a module-scoped flag resets on wake, so the
  // next click opened the panel through the retained setting AND a tab through
  // the listener. Removing it removes both the dead case and the double-open,
  // and `side_panel.default_path` keeps the panel reachable from the browser's
  // own side-panel control regardless.
  void sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
}

export default defineBackground(() => {
  void restrictLocalStorageToTrustedContexts().catch(() => undefined);
  installPackActionOpensSidePanel();
  installFiledReturnsDurableDownloadReconciler(undefined, {
    storageKeys: filedReturnsStorageKeys(),
    reconcileAllSupportedFullFiscalYearZip: (downloadId) =>
      reconcilePendingAllSupportedFullFiscalYearZipDownload(
        downloadId,
        filedReturnsFlowRunnerDeps(),
      ),
    reconcileFullFiscalYearZip: (downloadId) =>
      reconcilePendingFullFiscalYearZipDownload(downloadId, filedReturnsFlowRunnerDeps()),
    reconcilePersistedAllSupportedFullFiscalYearZip: () =>
      reconcilePersistedAllSupportedFullFiscalYearZipDownload(filedReturnsFlowRunnerDeps()),
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
    case "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW":
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
    case "PACK_GET_CONTEXT":
      return "the current GST Portal state";
    case "PACK_GET_FILED_RETURNS_FLOW_SUMMARY":
      return "saved local recovery state";
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
    case "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW":
      return "background-message-handler:filed-returns-all-supported-start";
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
    case "PACK_GET_CONTEXT":
      return "background-message-handler:gst-context";
    case "PACK_GET_FILED_RETURNS_FLOW_SUMMARY":
      return "background-message-handler:filed-returns-summary";
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
    if (sender.id === browser.runtime.id) {
      if (isFiledReturnsObservationEnvelope(message) && isSupportedGstBrowserTab(sender.tab)) {
        await browser.storage.session.remove(PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation);
      }
      if (isContentContextEnvelope(message) && isTrustedGstContextReporterTab(sender.tab)) {
        await browser.storage.session.remove(PACK_SESSION_STORAGE_KEYS.lastContext);
      }
    }
    return { ok: false, error: "Unsupported Pack message." };
  }

  switch (message.type) {
    case "PACK_CONTENT_CONTEXT": {
      if (sender.id !== browser.runtime.id || !isTrustedGstContextReporterTab(sender.tab)) {
        return { ok: false, error: "Invalid Pack sender or context." };
      }
      const context = await persistCanonicalGstPortalContext(
        PACK_SESSION_STORAGE_KEYS.lastContext,
        message.payload,
        sender.tab.url,
      );
      if (!context) return { ok: false, error: "Invalid Pack sender or context." };
      // Error and logout pages may report context but must never replace the
      // remembered actionable tab used by navigation/download operations.
      if (isSupportedGstBrowserTab(sender.tab)) {
        await browser.storage.session.set({
          [PACK_SESSION_STORAGE_KEYS.lastGstTabId]: sender.tab.id,
        });
      }
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
    case "PACK_GET_FILED_RETURNS_FLOW_SUMMARY": {
      await reconcileTerminalFiledReturnsDownload(browser.downloads, {
        storageKeys: filedReturnsStorageKeys(),
      }).catch(() => undefined);
      const allSupportedFullFiscalYearFlowSummary =
        await readCurrentAllSupportedFullFiscalYearFlowSummary({
          storageKeys: filedReturnsStorageKeys(),
        });
      const flowSummary = await readCurrentFiledReturnsFlowSummary({
        storageKeys: filedReturnsStorageKeys(),
      });
      // A stale compatibility lease has the only acknowledgement route. Show
      // it long enough to clear that lease; the next summary read returns the
      // authoritative all-supported root and its retained recovery state.
      if (
        allSupportedFullFiscalYearFlowSummary &&
        !["complete", "cancelled"].includes(allSupportedFullFiscalYearFlowSummary.status) &&
        isStaleAllSupportedCompatibilityLease(flowSummary, allSupportedFullFiscalYearFlowSummary)
      ) {
        return { ok: true, flowSummary };
      }
      // All-supported runs use one atomic lease for mutual exclusion, but that
      // lease cannot represent their cross-return progress or recovery. Any
      // unresolved root therefore remains authoritative over its compatibility
      // lease, including after the lease becomes stale.
      if (
        allSupportedFullFiscalYearFlowSummary &&
        !["complete", "cancelled"].includes(allSupportedFullFiscalYearFlowSummary.status)
      ) {
        return { ok: true, allSupportedFullFiscalYearFlowSummary };
      }
      // An atomic recovery is the only record that can authorise work on its
      // exact target. Do not bury it behind retained all-supported history.
      if (flowSummary && !["complete", "cancelled"].includes(flowSummary.status)) {
        return { ok: true, flowSummary };
      }
      if (allSupportedFullFiscalYearFlowSummary) {
        return { ok: true, allSupportedFullFiscalYearFlowSummary };
      }
      return {
        ok: true,
        flowSummary,
      };
    }
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
    case "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW":
      return startAllSupportedFiledReturnsFullFiscalYearDownloadFlow(
        message.payload,
        filedReturnsFlowRunnerDeps(),
      );
    case "PACK_RESTART_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW":
      return startAllSupportedFiledReturnsFullFiscalYearDownloadFlow(
        message.payload,
        filedReturnsFlowRunnerDeps(),
        { discardCompletedPlanRoot: true },
      );
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

function isStaleAllSupportedCompatibilityLease(
  flowSummary: Awaited<ReturnType<typeof readCurrentFiledReturnsFlowSummary>>,
  allSupportedSummary: NonNullable<
    Awaited<ReturnType<typeof readCurrentAllSupportedFullFiscalYearFlowSummary>>
  >,
): boolean {
  return Boolean(
    flowSummary &&
    flowSummary.status === "blocked" &&
    flowSummary.scope.period === "FULL_FISCAL_YEAR" &&
    flowSummary.scope.financialYear === allSupportedSummary.summaryIdentity.financialYear &&
    flowSummary.flowStep.safeSignals.includes("filed-returns-run-needs-review"),
  );
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
      allSupportedFullFiscalYearLedgerIndex:
        PACK_LOCAL_STORAGE_KEYS.allSupportedFullFiscalYearLedgerIndex,
      fullFiscalYearLedger: PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedger,
      fullFiscalYearLedgerIndex: PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedgerIndex,
      targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
    },
  });
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}

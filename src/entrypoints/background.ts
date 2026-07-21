import { browser } from "wxt/browser";
import type { ArchiveManifest, PortalObservation } from "../core/contracts";
import { isFullFiscalYearScope } from "../core/filed-returns-scope";
import { PACK_PRODUCT_VERSION } from "../extension/version";
import { isPackMessage, type PackMessageResponse } from "../core/messages";
import {
  acknowledgeInterruptedFiledReturnsRun,
  readActiveFiledReturnsRunSummary,
} from "../background/filed-returns-active-run";
import {
  pauseFullFiscalYearSummary,
  readCurrentFiledReturnsFlowSummary,
} from "../background/filed-returns-current-state";
import { resolveFullFiscalYearTarget } from "../background/filed-returns-full-fiscal-year-recovery";
import {
  retryFiledReturnsTargetDownloadFlow,
  fullFiscalYearPausedResponse,
  startFreshFiledReturnsDownloadFlow,
  startFiledReturnsDownloadFlow,
} from "../background/filed-returns-flow-runner";
import { resolveUnconfirmedFiledReturnsDownload } from "../background/filed-returns-target-review";
import { clearPackLocalDataWithRecoveryGuard } from "../background/local-data";
import {
  acknowledgeLocalProcessing,
  readLocalProcessingAcknowledgement,
} from "../background/local-processing-acknowledgement";
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

let trustedLocalStorageInitialization: Promise<void> | null = null;

export default defineBackground(() => {
  trustedLocalStorageInitialization = restrictLocalStorageToTrustedContexts();
  void trustedLocalStorageInitialization.catch(() => undefined);

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void rememberActiveGstTabById(tabId).catch(() => undefined);
  });

  browser.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => {
    void rememberGstTabIfSupported(tab).catch(() => undefined);
  });

  browser.runtime.onInstalled.addListener(() => {
    void withTrustedLocalStorage(() =>
      browser.storage.local.set({
        [PACK_LOCAL_STORAGE_KEYS.install]: {
          version: packRuntimeVersion(),
          installedAt: new Date().toISOString(),
          localOnly: true,
        },
      }),
    ).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void handleMessageAfterTrustedStorageInitialization(message, sender)
      .then((response) => sendResponse(response))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unexpected Pack error.",
        } satisfies PackMessageResponse),
      );
    return true;
  });
});

export async function restrictLocalStorageToTrustedContexts(): Promise<void> {
  const storageArea = browser.storage.local as typeof browser.storage.local & {
    setAccessLevel?: (options: { accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void> | void;
  };
  if (!storageArea.setAccessLevel) {
    throw new Error("Pack could not restrict local storage to trusted extension contexts.");
  }
  await storageArea.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

async function handleMessageAfterTrustedStorageInitialization(
  message: unknown,
  sender: Browser.runtime.MessageSender,
): Promise<PackMessageResponse> {
  try {
    await withTrustedLocalStorage(() => Promise.resolve());
  } catch {
    return {
      ok: false,
      error:
        "Pack could not initialize private local storage. Reload the extension before starting a GST download.",
    };
  }
  return handleMessage(message, sender);
}

async function withTrustedLocalStorage<T>(action: () => Promise<T>): Promise<T> {
  if (!trustedLocalStorageInitialization) {
    throw new Error("Pack local storage is not initialized.");
  }
  await trustedLocalStorageInitialization;
  return action();
}

async function handleMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
): Promise<PackMessageResponse> {
  if (!isPackMessage(message)) return { ok: false, error: "Unsupported Pack message." };

  switch (message.type) {
    case "PACK_CONTENT_CONTEXT": {
      if (sender.id !== browser.runtime.id) return { ok: false, error: "Invalid Pack sender." };
      const nextSessionValues: Record<string, unknown> = {
        [PACK_SESSION_STORAGE_KEYS.lastContext]: message.payload,
      };
      if (isSupportedGstBrowserTab(sender.tab)) {
        nextSessionValues[PACK_SESSION_STORAGE_KEYS.lastGstTabId] = sender.tab.id;
      }
      await browser.storage.session.set({
        ...nextSessionValues,
      });
      return { ok: true, context: message.payload };
    }
    case "PACK_FILED_RETURNS_OBSERVATION": {
      if (sender.id !== browser.runtime.id) return { ok: false, error: "Invalid Pack sender." };
      await browser.storage.session.set({
        [PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation]: message.payload,
      });
      return { ok: true, observation: message.payload };
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
          (await readSessionValue<PortalObservation>(
            PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation,
          )),
      };
    }
    case "PACK_GET_FILED_RETURNS_FLOW_SUMMARY":
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
    case "PACK_GET_LOCAL_PROCESSING_ACKNOWLEDGEMENT":
      return {
        ok: true,
        localProcessingAcknowledgement: await readLocalProcessingAcknowledgement(
          PACK_LOCAL_STORAGE_KEYS.localProcessingAcknowledgement,
        ),
      };
    case "PACK_ACKNOWLEDGE_LOCAL_PROCESSING":
      return {
        ok: true,
        localProcessingAcknowledgement: await acknowledgeLocalProcessing(
          PACK_LOCAL_STORAGE_KEYS.localProcessingAcknowledgement,
        ),
      };
    case "PACK_ACKNOWLEDGE_INTERRUPTED_RUN":
      return acknowledgeInterruptedFiledReturnsRun({
        storageKeys: { activeRun: PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun },
      });
    case "PACK_RETRY_FILED_RETURNS_TARGET":
      if (!(await hasCurrentLocalProcessingAcknowledgement())) {
        return localProcessingAcknowledgementRequiredResponse();
      }
      return retryFiledReturnsTargetDownloadFlow(message.payload, filedReturnsFlowRunnerDeps());
    case "PACK_RETRY_FULL_FISCAL_YEAR_TARGET":
      return pausedSavedFullFiscalYearResponse();
    case "PACK_RESOLVE_UNCONFIRMED_DOWNLOAD":
      return resolveUnconfirmedFiledReturnsDownload(
        message.payload.scope,
        message.payload.resolution,
        {
          storageKeys: {
            completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
            targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
          },
        },
      );
    case "PACK_RESOLVE_FULL_FISCAL_YEAR_TARGET":
      if (message.payload.resolution === "manually-observed") {
        return pausedSavedFullFiscalYearResponse();
      }
      return resolveFullFiscalYearTarget(
        message.payload,
        message.payload.resolution,
        filedReturnsFlowRunnerDeps(),
      );
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
      if (!(await hasCurrentLocalProcessingAcknowledgement())) {
        return localProcessingAcknowledgementRequiredResponse();
      }
      if (isFullFiscalYearScope(message.payload))
        return fullFiscalYearPausedResponse(message.payload);
      return startFiledReturnsDownloadFlow(message.payload, filedReturnsFlowRunnerDeps());
    case "PACK_START_FRESH_FILED_RETURNS_DOWNLOAD_FLOW":
      if (!(await hasCurrentLocalProcessingAcknowledgement())) {
        return localProcessingAcknowledgementRequiredResponse();
      }
      if (isFullFiscalYearScope(message.payload.scope)) {
        return fullFiscalYearPausedResponse(message.payload.scope);
      }
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

async function hasCurrentLocalProcessingAcknowledgement(): Promise<boolean> {
  return (
    (await readLocalProcessingAcknowledgement(
      PACK_LOCAL_STORAGE_KEYS.localProcessingAcknowledgement,
    )) !== null
  );
}

function localProcessingAcknowledgementRequiredResponse(): PackMessageResponse {
  return {
    ok: false,
    error:
      "Review and acknowledge Pack's local-processing boundary before starting or retrying a GST download.",
  };
}

async function pausedSavedFullFiscalYearResponse(): Promise<PackMessageResponse> {
  const summary = await readCurrentFiledReturnsFlowSummary({
    storageKeys: filedReturnsStorageKeys(),
  });
  if (summary && isFullFiscalYearScope(summary.scope)) {
    const pausedSummary = pauseFullFiscalYearSummary(summary);
    return { ok: true, flowStep: pausedSummary.flowStep, flowSummary: pausedSummary };
  }
  return {
    ok: false,
    error: "Pack did not find a saved full fiscal-year run to inspect or discard.",
  };
}

function packRuntimeVersion() {
  return browser.runtime.getManifest().version ?? PACK_PRODUCT_VERSION;
}

function filedReturnsFlowRunnerDeps() {
  return {
    getActiveGstTab,
    // The authenticated portal click/capture remains the default. Browser-initiated
    // direct endpoint downloads are retained for targeted tests only: Brave can
    // reject their initiator context even when the active portal session is valid.
    preferDirectDownload: false,
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

async function readSessionValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.session.get(key);
  return (values[key] as T | undefined) ?? null;
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}

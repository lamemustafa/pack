import { browser } from "wxt/browser";
import type { ArchiveManifest } from "../core/contracts";
import { PACK_PRODUCT_VERSION } from "../extension/version";
import { isPackMessage, type PackMessageResponse } from "../connectors/gst/messages";
import {
  acknowledgeInterruptedFiledReturnsRun,
  readActiveFiledReturnsRunSummary,
} from "../background/filed-returns-active-run";
import { readCurrentFiledReturnsFlowSummary } from "../background/filed-returns-current-state";
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

export default defineBackground(() => {
  void restrictLocalStorageToTrustedContexts().catch(() => undefined);
  installFiledReturnsDurableDownloadReconciler();
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
    void handleMessage(message, sender)
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

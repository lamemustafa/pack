import { browser } from "wxt/browser";
import {
  GST_PORTAL_TAB_URL_PATTERNS,
  isActionableGstPortalTabUrl,
  pickSupportedGstPortalTab,
  pickUniquePreferredGstPortalTab,
} from "../connectors/gst/hosts";
import type { ArchiveManifest, PortalContext, PortalObservation } from "../core/contracts";
import { PACK_PRODUCT_VERSION } from "../extension/version";
import {
  PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
  isPackMessage,
  type PackMessage,
  type PackMessageResponse,
} from "../core/messages";
import {
  acknowledgeInterruptedFiledReturnsRun,
  readActiveFiledReturnsRunSummary,
} from "../background/filed-returns-active-run";
import { readCurrentFiledReturnsFlowSummary } from "../background/filed-returns-current-state";
import { resolveFullFiscalYearTarget } from "../background/filed-returns-full-fiscal-year-recovery";
import {
  retryFullFiscalYearTargetDownloadFlow,
  startFiledReturnsDownloadFlow,
  type ActiveGstTab,
} from "../background/filed-returns-flow-runner";
import { observeFiledReturnsPageText } from "../connectors/gst/filed-returns-observer";
import {
  clearFiledReturnsTargetReview,
  resolveUnconfirmedFiledReturnsDownload,
} from "../background/filed-returns-target-review";
import { clearPackLocalDataWithRecoveryGuard } from "../background/local-data";
import { startSyntheticDemo } from "../background/synthetic-demo";
import { runDownloadPromptProbe } from "../background/download-prompt-probe";
import {
  PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
  PACK_LOCAL_STORAGE_KEYS,
  PACK_SESSION_STORAGE_KEYS,
  filedReturnsStorageKeys,
} from "../background/storage-keys";

export {
  PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
  PACK_LOCAL_STORAGE_KEYS,
  PACK_SESSION_STORAGE_KEYS,
  filedReturnsStorageKeys,
} from "../background/storage-keys";

const CONTENT_SCRIPT_FILE = "/content-scripts/content.js";
const OFFICIAL_URL = "https://pack.complyeaze.com";
const contentInjectionByTab = new Map<number, Promise<void>>();

export default defineBackground(() => {
  void restrictLocalStorageToTrustedContexts().catch(() => undefined);

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

export function isCurrentContentScriptPingResponse(response: PackMessageResponse): boolean {
  return (
    response.ok &&
    "contentScriptVersion" in response &&
    response.contentScriptVersion === PACK_CONTENT_SCRIPT_PROTOCOL_VERSION
  );
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
    case "PACK_ACKNOWLEDGE_INTERRUPTED_RUN":
      return acknowledgeInterruptedFiledReturnsRun({
        storageKeys: { activeRun: PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun },
      });
    case "PACK_RETRY_FILED_RETURNS_TARGET":
      await clearFiledReturnsTargetReview(message.payload, {
        storageKeys: { targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview },
      });
      return startFiledReturnsDownloadFlow(message.payload, filedReturnsFlowRunnerDeps());
    case "PACK_RETRY_FULL_FISCAL_YEAR_TARGET":
      return retryFullFiscalYearTargetDownloadFlow(message.payload, filedReturnsFlowRunnerDeps());
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
      return resolveFullFiscalYearTarget(
        message.payload,
        message.payload.resolution,
        filedReturnsFlowRunnerDeps(),
      );
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
      return startFiledReturnsDownloadFlow(message.payload, filedReturnsFlowRunnerDeps());
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

function packRuntimeVersion() {
  return browser.runtime.getManifest().version ?? PACK_PRODUCT_VERSION;
}

function filedReturnsFlowRunnerDeps() {
  return {
    getActiveGstTab,
    preferDirectDownload: true,
    sendMessageToTabWithInjection,
    storageKeys: filedReturnsStorageKeys(),
  };
}

async function refreshActiveFiledReturnsObservation(): Promise<PortalObservation | null> {
  const activeTab = await getActiveGstTab();
  if (!activeTab) return null;

  const response = await sendMessageToTabWithInjection(activeTab.id, {
    type: "PACK_CONTENT_REFRESH_FILED_RETURNS_OBSERVATION_V3",
  });

  if (!response.ok) return null;

  if ("observation" in response && response.observation) {
    await browser.storage.session.set({
      [PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation]: response.observation,
    });
    return response.observation;
  }
  return null;
}

async function inferActiveFiledReturnsObservation(): Promise<PortalObservation | null> {
  const activeTab = await getActiveGstTab();
  if (!activeTab?.url) return null;

  let parsed: URL;
  try {
    parsed = new URL(activeTab.url);
  } catch {
    return null;
  }

  if (
    parsed.origin === "https://gstr2b.gst.gov.in" &&
    /\/gstr2b\/auth\/gstr2b\/summary\/?$/i.test(parsed.pathname)
  ) {
    const observation = observeFiledReturnsPageText("GSTR-2B", {
      pathname: parsed.pathname,
    });
    await browser.storage.session.set({
      [PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation]: observation,
    });
    return observation;
  }

  return null;
}

async function refreshActiveGstContext(): Promise<PortalContext | null> {
  const activeTab = await getActiveGstTab();
  if (!activeTab) return null;

  const response = await sendMessageToTabWithInjection(activeTab.id, {
    type: "PACK_CONTENT_REFRESH_CONTEXT_V3",
  });

  if (!response.ok || !("context" in response)) return null;

  await browser.storage.session.set({
    [PACK_SESSION_STORAGE_KEYS.lastContext]: response.context,
  });
  return response.context;
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

export async function getActiveGstTab(): Promise<ActiveGstTab | null> {
  const activeCurrentWindowTabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeGstTab = pickSupportedGstPortalTab<Browser.tabs.Tab>(activeCurrentWindowTabs);
  if (activeGstTab) return activeGstTab;

  const urlMatchedCurrentWindowTabs = await browser.tabs.query({
    currentWindow: true,
    url: [...GST_PORTAL_TAB_URL_PATTERNS],
  });
  const urlMatchedGstTab = pickUniquePreferredGstPortalTab(urlMatchedCurrentWindowTabs);
  if (urlMatchedGstTab) return urlMatchedGstTab;

  const rememberedGstTab = await readRememberedGstTab();
  if (rememberedGstTab) return rememberedGstTab;

  const currentWindowTabs = await browser.tabs.query({ currentWindow: true });
  const fallbackGstTabs = currentWindowTabs.filter(
    (tab): tab is Browser.tabs.Tab & { id: number } =>
      typeof tab.id === "number" && isActionableGstPortalTabUrl(tab.url),
  );
  if (fallbackGstTabs.length === 1) return fallbackGstTabs[0] ?? null;
  return pickUniquePreferredGstPortalTab(fallbackGstTabs);
}

export async function rememberActiveGstTabById(tabId: number): Promise<void> {
  try {
    await rememberGstTabIfSupported(await browser.tabs.get(tabId));
  } catch {
    // Tabs can disappear while Brave is switching focus; that should not interrupt Pack.
  }
}

export async function rememberGstTabIfSupported(tab: Browser.tabs.Tab | undefined): Promise<void> {
  if (!isSupportedGstBrowserTab(tab)) return;
  await browser.storage.session.set({
    [PACK_SESSION_STORAGE_KEYS.lastGstTabId]: tab.id,
  });
}

async function readRememberedGstTab(): Promise<ActiveGstTab | null> {
  const tabId = await readSessionValue<number>(PACK_SESSION_STORAGE_KEYS.lastGstTabId);
  if (typeof tabId !== "number") return null;

  try {
    const tab = await browser.tabs.get(tabId);
    if (typeof tab.id !== "number" || !isActionableGstPortalTabUrl(tab.url)) return null;
    return tab as ActiveGstTab;
  } catch {
    return null;
  }
}

function isSupportedGstBrowserTab(
  tab: Browser.tabs.Tab | undefined,
): tab is Browser.tabs.Tab & { id: number } {
  return typeof tab?.id === "number" && isActionableGstPortalTabUrl(tab.url);
}

export async function sendMessageToTabWithInjection(
  tabId: number,
  message: Extract<
    PackMessage,
    {
      type:
        | "PACK_CONTENT_NAVIGATE_FILED_RETURNS_V3"
        | "PACK_CONTENT_REFRESH_CONTEXT_V3"
        | "PACK_CONTENT_REFRESH_FILED_RETURNS_OBSERVATION_V3"
        | "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3"
        | "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3"
        | "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3";
    }
  >,
): Promise<PackMessageResponse> {
  await ensureContentScript(tabId);
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as PackMessageResponse;
  } catch (error) {
    if (!isMissingReceivingEndError(error)) throw error;
    await ensureContentScript(tabId);
    return browser.tabs.sendMessage(tabId, message) as Promise<PackMessageResponse>;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (await pingContentScript(tabId)) return;

  let injection = contentInjectionByTab.get(tabId);
  if (!injection) {
    injection = browser.scripting
      .executeScript({
        files: [CONTENT_SCRIPT_FILE],
        target: { tabId },
      })
      .then(() => undefined)
      .finally(() => {
        contentInjectionByTab.delete(tabId);
      });
    contentInjectionByTab.set(tabId, injection);
  }

  await injection;
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = (await browser.tabs.sendMessage(tabId, {
      type: "PACK_CONTENT_PING_V2",
    })) as PackMessageResponse;
    return isCurrentContentScriptPingResponse(response);
  } catch {
    return false;
  }
}

function isMissingReceivingEndError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /receiving end does not exist|could not establish connection/i.test(message);
}

async function readSessionValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.session.get(key);
  return (values[key] as T | undefined) ?? null;
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}

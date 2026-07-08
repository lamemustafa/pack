import { browser } from "wxt/browser";
import {
  GST_PORTAL_TAB_URL_PATTERNS,
  isActionableGstPortalTabUrl,
  pickSupportedGstPortalTab,
  pickUniquePreferredGstPortalTab,
} from "../connectors/gst/hosts";
import { observeFiledReturnsPageText } from "../connectors/gst/filed-returns-observer";
import type { PortalContext, PortalObservation } from "../core/contracts";
import {
  PACK_CONTENT_SCRIPT_PROTOCOL_VERSION,
  type PackMessage,
  type PackMessageResponse,
} from "../core/messages";
import type { ActiveGstTab } from "./filed-returns-flow-runner";
import { PACK_SESSION_STORAGE_KEYS } from "./storage-keys";

const CONTENT_SCRIPT_FILE = "/content-scripts/content.js";
const contentInjectionByTab = new Map<number, Promise<void>>();

export function isCurrentContentScriptPingResponse(response: PackMessageResponse): boolean {
  return (
    response.ok &&
    "contentScriptVersion" in response &&
    response.contentScriptVersion === PACK_CONTENT_SCRIPT_PROTOCOL_VERSION
  );
}

export async function refreshActiveFiledReturnsObservation(): Promise<PortalObservation | null> {
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

export async function inferActiveFiledReturnsObservation(): Promise<PortalObservation | null> {
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

export async function refreshActiveGstContext(): Promise<PortalContext | null> {
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

export function isSupportedGstBrowserTab(
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

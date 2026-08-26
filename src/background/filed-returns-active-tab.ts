import { browser } from "wxt/browser";
import { isActionableGstPortalTabUrl } from "../connectors/gst/hosts";
import { PACK_SESSION_STORAGE_KEYS } from "./storage-keys";

export type ActiveGstTab = Browser.tabs.Tab & { id: number };

export async function getRequiredGstTab(
  getActiveGstTab: () => Promise<ActiveGstTab | null>,
  requiredTabId?: number,
  requiredTabSessionId?: string,
): Promise<{ tab: ActiveGstTab } | null> {
  if (
    requiredTabSessionId !== undefined &&
    (await getFullFiscalYearTabSessionId()) !== requiredTabSessionId
  ) {
    return null;
  }
  const activeTab =
    requiredTabId === undefined ? await getActiveGstTab() : await getPinnedGstTab(requiredTabId);
  if (!activeTab) return null;
  await focusTab(activeTab);
  return { tab: activeTab };
}

export async function getFullFiscalYearTabSessionId(): Promise<string | null> {
  try {
    const key = PACK_SESSION_STORAGE_KEYS.fullFiscalYearTabSession;
    const values = await browser.storage.session.get(key);
    const existing = values[key];
    if (typeof existing === "string" && /^[a-z0-9-]{16,120}$/i.test(existing)) return existing;
    const sessionId = crypto.randomUUID();
    await browser.storage.session.set({ [key]: sessionId });
    return sessionId;
  } catch {
    return null;
  }
}

async function getPinnedGstTab(tabId: number): Promise<ActiveGstTab | null> {
  try {
    const tab = await browser.tabs.get(tabId);
    return typeof tab.id === "number" && isActionableGstPortalTabUrl(tab.url)
      ? (tab as ActiveGstTab)
      : null;
  } catch {
    return null;
  }
}

async function focusTab(tab: ActiveGstTab): Promise<void> {
  await browser.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    await browser.windows.update(tab.windowId, { focused: true });
  }
}

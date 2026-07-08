import { browser } from "wxt/browser";

export type ActiveGstTab = Browser.tabs.Tab & { id: number };

export async function getRequiredGstTab(
  getActiveGstTab: () => Promise<ActiveGstTab | null>,
): Promise<{ tab: ActiveGstTab } | null> {
  const activeTab = await getActiveGstTab();
  if (!activeTab) return null;
  await focusTab(activeTab);
  return { tab: activeTab };
}

async function focusTab(tab: ActiveGstTab): Promise<void> {
  await browser.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    await browser.windows.update(tab.windowId, { focused: true });
  }
}

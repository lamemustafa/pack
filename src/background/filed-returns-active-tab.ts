import { browser } from "wxt/browser";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";

const GST_SERVICES_ORIGIN = GST_CONNECTOR_DESCRIPTOR.supportedOrigins[1] ?? "";
const GST_LOGIN_URL = new URL("/services/login", GST_SERVICES_ORIGIN).href;

export type ActiveGstTab = Browser.tabs.Tab & { id: number };

export async function getOrOpenGstTab(
  getActiveGstTab: () => Promise<ActiveGstTab | null>,
): Promise<{ tab: ActiveGstTab; openedForLogin: false } | { openedForLogin: true }> {
  const activeTab = await getActiveGstTab();
  if (activeTab) {
    await focusTab(activeTab);
    return { tab: activeTab, openedForLogin: false };
  }

  await browser.tabs.create({ active: true, url: GST_LOGIN_URL });
  return { openedForLogin: true };
}

async function focusTab(tab: ActiveGstTab): Promise<void> {
  await browser.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    await browser.windows.update(tab.windowId, { focused: true });
  }
}

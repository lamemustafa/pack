import { browser } from "wxt/browser";
import { syntheticDownloadArtifacts } from "../connectors/gst/demo";
import { pickSupportedGstPortalTab } from "../connectors/gst/hosts";
import {
  DEFAULT_GST_RETURN_SCOPE,
  createGstReturnPlan,
  createSyntheticGstResults,
} from "../connectors/gst/planner";
import type {
  ArchiveManifest,
  FiledReturnsFlowSummary,
  PortalContext,
  PortalObservation,
} from "../core/contracts";
import { createArchiveManifest } from "../core/manifest";
import { isPackMessage, type PackMessage, type PackMessageResponse } from "../core/messages";
import { summariseFullFiscalYearLedger } from "../background/filed-returns-full-fiscal-year";
import { isFullFiscalYearLedger } from "../background/filed-returns-full-fiscal-year-ledger";
import {
  startFiledReturnsDownloadFlow,
  type ActiveGstTab,
} from "../background/filed-returns-flow-runner";

export const PACK_LOCAL_STORAGE_KEYS = {
  fullFiscalYearLedger: "pack:full-fiscal-year-ledger",
  install: "pack:install",
  lastManifest: "pack:last-manifest",
} as const;

export const PACK_SESSION_STORAGE_KEYS = {
  lastContext: "pack:last-context",
  lastFiledReturnsObservation: "pack:last-filed-returns-observation",
  lastFiledReturnsFlowSummary: "pack:last-filed-returns-flow-summary",
} as const;

export const PACK_CLEARABLE_LOCAL_STORAGE_KEYS = Object.values(PACK_LOCAL_STORAGE_KEYS);

const CONTENT_SCRIPT_FILE = "/content-scripts/content.js";
const PRODUCT_VERSION = "0.1.0";
const OFFICIAL_URL = "https://pack.complyeaze.com";
const contentInjectionByTab = new Map<number, Promise<void>>();

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void browser.storage.local.set({
      [PACK_LOCAL_STORAGE_KEYS.install]: {
        version: PRODUCT_VERSION,
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

async function handleMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
): Promise<PackMessageResponse> {
  if (!isPackMessage(message)) return { ok: false, error: "Unsupported Pack message." };

  switch (message.type) {
    case "PACK_CONTENT_CONTEXT": {
      if (sender.id !== browser.runtime.id) return { ok: false, error: "Invalid Pack sender." };
      await browser.storage.session.set({
        [PACK_SESSION_STORAGE_KEYS.lastContext]: message.payload,
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
        context: await readSessionValue<PortalContext>(PACK_SESSION_STORAGE_KEYS.lastContext),
      };
    case "PACK_GET_FILED_RETURNS_OBSERVATION":
      await refreshActiveFiledReturnsObservation();
      return {
        ok: true,
        observation: await readSessionValue<PortalObservation>(
          PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation,
        ),
      };
    case "PACK_GET_FILED_RETURNS_FLOW_SUMMARY":
      return {
        ok: true,
        flowSummary: await readFiledReturnsFlowSummary(),
      };
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
      return startFiledReturnsDownloadFlow(message.payload, {
        getActiveGstTab,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
          fullFiscalYearLedger: PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedger,
          observation: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation,
        },
      });
    case "PACK_START_SYNTHETIC_DEMO":
      return startSyntheticDemo();
    case "PACK_CLEAR_LOCAL_DATA":
      await clearPackLocalData();
      return { ok: true, cleared: true };
    case "PACK_GET_LAST_MANIFEST":
      return {
        ok: true,
        manifest: await readLocalValue<ArchiveManifest>(PACK_LOCAL_STORAGE_KEYS.lastManifest),
      };
  }

  return { ok: false, error: "Unsupported Pack message." };
}

async function refreshActiveFiledReturnsObservation(): Promise<void> {
  const activeTab = await getActiveGstTab();
  if (!activeTab) return;

  const response = await sendMessageToTabWithInjection(activeTab.id, {
    type: "PACK_REFRESH_FILED_RETURNS_OBSERVATION",
  });

  if (!response.ok) return;

  if ("observation" in response && response.observation) {
    await browser.storage.session.set({
      [PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation]: response.observation,
    });
  }
}

export async function clearPackLocalData(): Promise<void> {
  await browser.storage.session.clear();
  await browser.storage.local.remove([...PACK_CLEARABLE_LOCAL_STORAGE_KEYS]);
}

async function getActiveGstTab(): Promise<ActiveGstTab | null> {
  const currentWindowTabs = await browser.tabs.query({ active: true, currentWindow: true });
  return pickSupportedGstPortalTab<Browser.tabs.Tab>(currentWindowTabs);
}

async function sendMessageToTabWithInjection(
  tabId: number,
  message: Extract<
    PackMessage,
    {
      type:
        | "PACK_NAVIGATE_FILED_RETURNS"
        | "PACK_REFRESH_FILED_RETURNS_OBSERVATION"
        | "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD"
        | "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP";
    }
  >,
): Promise<PackMessageResponse> {
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
      type: "PACK_PING",
    })) as PackMessageResponse;
    return response.ok;
  } catch {
    return false;
  }
}

function isMissingReceivingEndError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /receiving end does not exist|could not establish connection/i.test(message);
}

async function startSyntheticDemo(): Promise<PackMessageResponse> {
  const startedAt = new Date();
  const plan = createGstReturnPlan(DEFAULT_GST_RETURN_SCOPE, startedAt);
  const completedAt = new Date(startedAt.getTime() + 250);
  const results = createSyntheticGstResults(plan, completedAt);
  const manifest = createArchiveManifest(plan, results, {
    productVersion: PRODUCT_VERSION,
    build: browser.runtime.getManifest().version,
    officialUrl: OFFICIAL_URL,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    browserFamily: "Chrome",
  });

  let downloaded = 0;
  for (const artifact of syntheticDownloadArtifacts(plan, results, manifest)) {
    await browser.downloads.download({
      conflictAction: "uniquify",
      filename: `Pack-Demo/${artifact.filename}`,
      saveAs: false,
      url: makeDataUrl(artifact.mimeType, artifact.body),
    });
    downloaded += 1;
  }

  await browser.storage.local.set({ [PACK_LOCAL_STORAGE_KEYS.lastManifest]: manifest });
  return { ok: true, downloaded, manifest };
}

async function readSessionValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.session.get(key);
  return (values[key] as T | undefined) ?? null;
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}

async function readFiledReturnsFlowSummary(): Promise<FiledReturnsFlowSummary | null> {
  const sessionSummary = await readSessionValue<FiledReturnsFlowSummary>(
    PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
  );
  if (sessionSummary) return sessionSummary;

  const ledger = await readLocalValue<unknown>(PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedger);
  if (!isFullFiscalYearLedger(ledger)) return null;
  return summariseFullFiscalYearLedger(ledger);
}

function makeDataUrl(mimeType: string, body: string): string {
  return `data:${mimeType};base64,${base64Encode(body)}`;
}

function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

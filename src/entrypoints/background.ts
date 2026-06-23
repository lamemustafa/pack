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
  PortalRequestShape,
} from "../core/contracts";
import { createArchiveManifest } from "../core/manifest";
import { isPackMessage, type PackMessage, type PackMessageResponse } from "../core/messages";
import {
  startFiledReturnsDownloadFlow,
  type ActiveGstTab,
} from "../background/filed-returns-flow-runner";
import { DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE } from "../core/filed-returns-scope";

const LAST_CONTEXT_KEY = "pack:last-context";
const LAST_FILED_RETURNS_OBSERVATION_KEY = "pack:last-filed-returns-observation";
const LAST_FILED_RETURNS_REQUEST_SHAPES_KEY = "pack:last-filed-returns-request-shapes";
const LAST_FILED_RETURNS_FLOW_SUMMARY_KEY = "pack:last-filed-returns-flow-summary";
const LAST_MANIFEST_KEY = "pack:last-manifest";
const CONTENT_SCRIPT_FILE = "/content-scripts/content.js";
const PRODUCT_VERSION = "0.1.0";
const OFFICIAL_URL = "https://pack.complyeaze.com";
const START_FILED_RETURNS_COMMAND = "pack-start-filed-returns-download";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void browser.storage.local.set({
      "pack:install": {
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

  browser.commands.onCommand.addListener((command) => {
    if (command !== START_FILED_RETURNS_COMMAND) return;
    void handleMessage(
      {
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE,
      } satisfies PackMessage,
      {
        id: browser.runtime.id,
      },
    ).catch(() => undefined);
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
      await browser.storage.session.set({ [LAST_CONTEXT_KEY]: message.payload });
      return { ok: true, context: message.payload };
    }
    case "PACK_FILED_RETURNS_OBSERVATION": {
      if (sender.id !== browser.runtime.id) return { ok: false, error: "Invalid Pack sender." };
      await browser.storage.session.set({ [LAST_FILED_RETURNS_OBSERVATION_KEY]: message.payload });
      return { ok: true, observation: message.payload };
    }
    case "PACK_FILED_RETURNS_REQUEST_SHAPES": {
      if (sender.id !== browser.runtime.id) return { ok: false, error: "Invalid Pack sender." };
      const previous =
        (await readSessionValue<PortalRequestShape[]>(LAST_FILED_RETURNS_REQUEST_SHAPES_KEY)) ?? [];
      const merged = mergeRequestShapes(previous, message.payload);
      await browser.storage.session.set({ [LAST_FILED_RETURNS_REQUEST_SHAPES_KEY]: merged });
      return { ok: true, requestShapes: merged };
    }
    case "PACK_GET_CONTEXT":
      return { ok: true, context: await readSessionValue<PortalContext>(LAST_CONTEXT_KEY) };
    case "PACK_GET_FILED_RETURNS_OBSERVATION":
      await refreshActiveFiledReturnsObservation();
      return {
        ok: true,
        observation: await readSessionValue<PortalObservation>(LAST_FILED_RETURNS_OBSERVATION_KEY),
      };
    case "PACK_GET_FILED_RETURNS_FLOW_SUMMARY":
      return {
        ok: true,
        flowSummary: await readSessionValue<FiledReturnsFlowSummary>(
          LAST_FILED_RETURNS_FLOW_SUMMARY_KEY,
        ),
      };
    case "PACK_GET_FILED_RETURNS_REQUEST_SHAPES":
      await refreshActiveFiledReturnsObservation();
      return {
        ok: true,
        requestShapes:
          (await readSessionValue<PortalRequestShape[]>(LAST_FILED_RETURNS_REQUEST_SHAPES_KEY)) ??
          [],
      };
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
      return startFiledReturnsDownloadFlow(message.payload, {
        getActiveGstTab,
        mergeRequestShapes,
        readSessionValue,
        sendMessageToTabWithInjection,
        storageKeys: {
          completion: LAST_FILED_RETURNS_FLOW_SUMMARY_KEY,
          observation: LAST_FILED_RETURNS_OBSERVATION_KEY,
          requestShapes: LAST_FILED_RETURNS_REQUEST_SHAPES_KEY,
        },
      });
    case "PACK_START_SYNTHETIC_DEMO":
      return startSyntheticDemo();
    case "PACK_CLEAR_LOCAL_DATA":
      await browser.storage.session.clear();
      await browser.storage.local.remove([LAST_MANIFEST_KEY]);
      return { ok: true, cleared: true };
    case "PACK_GET_LAST_MANIFEST":
      return { ok: true, manifest: await readLocalValue<ArchiveManifest>(LAST_MANIFEST_KEY) };
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
      [LAST_FILED_RETURNS_OBSERVATION_KEY]: response.observation,
    });
  }

  if ("requestShapes" in response && response.requestShapes) {
    const previous =
      (await readSessionValue<PortalRequestShape[]>(LAST_FILED_RETURNS_REQUEST_SHAPES_KEY)) ?? [];
    await browser.storage.session.set({
      [LAST_FILED_RETURNS_REQUEST_SHAPES_KEY]: mergeRequestShapes(previous, response.requestShapes),
    });
  }
}

async function getActiveGstTab(): Promise<ActiveGstTab | null> {
  const [currentWindowTabs, lastFocusedWindowTabs, allActiveTabs] = await Promise.all([
    browser.tabs.query({ active: true, currentWindow: true }),
    browser.tabs.query({ active: true, lastFocusedWindow: true }),
    browser.tabs.query({ active: true }),
  ]);
  return pickSupportedGstPortalTab<Browser.tabs.Tab>([
    ...currentWindowTabs,
    ...lastFocusedWindowTabs,
    ...allActiveTabs,
  ]);
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
  } catch {
    await browser.scripting.executeScript({
      files: [CONTENT_SCRIPT_FILE],
      target: { tabId },
    });
    return browser.tabs.sendMessage(tabId, message) as Promise<PackMessageResponse>;
  }
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

  await browser.storage.local.set({ [LAST_MANIFEST_KEY]: manifest });
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

function makeDataUrl(mimeType: string, body: string): string {
  return `data:${mimeType};base64,${base64Encode(body)}`;
}

function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function mergeRequestShapes(
  previous: readonly PortalRequestShape[],
  incoming: readonly PortalRequestShape[],
): PortalRequestShape[] {
  const dedupe = new Map<string, PortalRequestShape>();
  for (const shape of [...previous, ...incoming]) {
    dedupe.set(`${shape.origin}|${shape.pathShape}|${shape.initiatorType}`, shape);
  }
  return [...dedupe.values()].slice(-80);
}

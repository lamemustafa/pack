#!/usr/bin/env node
/* global chrome, document */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { chromium } from "@playwright/test";
import { LIVE_RUN_SENSITIVE_PATTERN_DEFINITIONS } from "./lib/live-run-evidence-redaction-patterns.mjs";

ensureHeadedChromiumDisplay();

const extensionDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), ".output", "chrome-mv3");
const chromiumExecutablePath = process.env.PACK_CHROMIUM_EXECUTABLE
  ? path.resolve(process.env.PACK_CHROMIUM_EXECUTABLE)
  : null;
const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
const profileDir = await mkdtemp(path.join(os.tmpdir(), "pack-browser-release-"));
let approvedOrigins = new Set();
const expectedHostPermissions = [
  "https://gstr2b.gst.gov.in/*",
  "https://return.gst.gov.in/*",
  "https://services.gst.gov.in/*",
  "https://www.gst.gov.in/*",
];
const expectedContentScripts = [
  {
    js: ["content-scripts/content.js"],
    matches: [
      "https://gstr2b.gst.gov.in/*",
      "https://return.gst.gov.in/*",
      "https://services.gst.gov.in/*",
      "https://www.gst.gov.in/*",
    ],
    runAt: "document_idle",
  },
];
const hostileOrigin = "https://hostile-pack.invalid";
const expectedDeniedNetworkProbe = "https://unexpected-pack-network.invalid/tracker.png";
const sensitivePatterns = LIVE_RUN_SENSITIVE_PATTERN_DEFINITIONS.map(({ id, pattern, flags }) => ({
  id,
  pattern: new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`),
}));

const browserLogs = [];
const deniedRequests = [];
const pageErrors = [];
const requestFailures = [];
let context;

try {
  assertStaticReleaseBrowserPolicy(manifest);
  approvedOrigins = buildApprovedOrigins(manifest);
  context = await launchExtensionContext();
  context.on("page", attachPageLogging);
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (!/^https?:\/\//i.test(url)) {
      await route.continue();
      return;
    }
    const origin = new URL(url).origin;
    if (origin === hostileOrigin) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: hostilePageHtml(),
      });
      return;
    }
    if (!approvedOrigins.has(origin)) {
      deniedRequests.push({
        expected: isExpectedDeniedNetworkProbe(url),
        url: sanitize(url),
      });
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: syntheticGstPage(url),
    });
  });

  const extensionId = await resolveExtensionId(context);
  const serviceWorker = await waitForServiceWorker(context, extensionId);
  await assertServiceWorkerStarted(serviceWorker);
  await assertOptionsPageLoads(context, extensionId);
  await assertPopupPageLoads(context, extensionId);
  await assertApprovedContentScript(context, serviceWorker);
  await assertHostilePageCannotMessageExtension(context);
  assertDeniedUnexpectedNetwork();
  assertSanitizedBrowserLogs();
  assertNoBrowserRuntimeFailures();

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        status: "pass",
        extensionDir: symbolic(extensionDir),
        chromiumChannel: chromiumExecutablePath ? "PACK_CHROMIUM_EXECUTABLE" : "chromium",
        extensionId: redactExtensionId(extensionId),
        approvedOrigins: [...approvedOrigins].sort(),
        deniedUnexpectedRequests: deniedRequests.map((request) => request.url),
        browserLogCount: browserLogs.length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist/i.test(message)) {
    throw new Error(
      `${sanitize(message)}\nInstall pinned Chromium with: pnpm exec playwright install chromium`,
    );
  }
  if (isChromiumCrashpadPermissionFailure(message)) {
    throw new Error(
      "Chromium exited before Pack loaded because macOS denied Chromium Crashpad application-support access. Run the Pack browser verifier from a normal local shell, or explicitly approve the unsandboxed verifier run in Codex, then retry. No Pack browser assertions ran in this attempt.",
    );
  }
  throw error;
} finally {
  await context?.close();
  await rm(profileDir, { force: true, recursive: true });
}

function assertStaticReleaseBrowserPolicy(input) {
  if (input.manifest_version !== 3) {
    throw new Error("Browser release verifier requires MV3 manifest.");
  }
  if (input.background?.service_worker !== "background.js") {
    throw new Error("Pack release must start the expected MV3 service worker.");
  }
  if (input.externally_connectable) {
    throw new Error("Pack release must not expose externally_connectable.");
  }
  if ((input.web_accessible_resources ?? []).length > 0) {
    throw new Error("Pack release must not expose web_accessible_resources.");
  }
  const actualHostPermissions = [...(input.host_permissions ?? [])].sort();
  const expectedHosts = [...expectedHostPermissions].sort();
  if (JSON.stringify(actualHostPermissions) !== JSON.stringify(expectedHosts)) {
    throw new Error("Pack host permissions must stay on the approved GST allow-list.");
  }
  const contentScripts = input.content_scripts ?? [];
  if (contentScripts.length !== expectedContentScripts.length) {
    throw new Error("Pack release must include only the approved content scripts.");
  }
  for (const expectedContentScript of expectedContentScripts) {
    const contentScript = contentScripts.find(
      (candidate) =>
        JSON.stringify(candidate.js ?? []) === JSON.stringify(expectedContentScript.js),
    );
    if (!contentScript) {
      throw new Error(`Pack content script bundle missing: ${expectedContentScript.js.join(", ")}`);
    }
    const actualMatches = [...(contentScript.matches ?? [])].sort();
    const expectedMatches = [...expectedContentScript.matches].sort();
    if (JSON.stringify(actualMatches) !== JSON.stringify(expectedMatches)) {
      throw new Error(
        `Pack content script matches changed unexpectedly: ${expectedContentScript.js.join(", ")}`,
      );
    }
    if (contentScript.run_at !== expectedContentScript.runAt) {
      throw new Error(
        `Pack content script run_at changed unexpectedly: ${expectedContentScript.js.join(", ")}`,
      );
    }
    if ((contentScript.world ?? undefined) !== (expectedContentScript.world ?? undefined)) {
      throw new Error(
        `Pack content script world changed unexpectedly: ${expectedContentScript.js.join(", ")}`,
      );
    }
  }
}

function buildApprovedOrigins(input) {
  return new Set(
    input.host_permissions.map((pattern) => new URL(pattern.replace(/\*$/, "")).origin),
  );
}

async function launchExtensionContext() {
  const isolatedBrowserHome = path.join(profileDir, "home");
  await mkdir(isolatedBrowserHome, { recursive: true });
  return chromium.launchPersistentContext(profileDir, {
    ...(chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : { channel: "chromium" }),
    env: {
      ...process.env,
      HOME: isolatedBrowserHome,
      XDG_CACHE_HOME: path.join(profileDir, "xdg-cache"),
      XDG_CONFIG_HOME: path.join(profileDir, "xdg-config"),
    },
    headless: false,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-breakpad",
      "--disable-crash-reporter",
      "--disable-crashpad",
      "--disable-default-apps",
      "--disable-features=AutofillServerCommunication,OptimizationHints,Translate",
      "--disable-sync",
      `--crash-dumps-dir=${path.join(profileDir, "Crashpad")}`,
      "--metrics-recording-only",
      "--no-first-run",
      "--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
}

async function resolveExtensionId(browserContext) {
  const existingServiceWorker = browserContext.serviceWorkers()[0];
  if (existingServiceWorker) return new URL(existingServiceWorker.url()).host;

  const wakePage = await browserContext.newPage();
  attachPageLogging(wakePage);
  await wakePage.goto("https://services.gst.gov.in/services/auth/fowelcome", {
    waitUntil: "domcontentloaded",
  });
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const serviceWorker = browserContext.serviceWorkers()[0];
      if (serviceWorker) return new URL(serviceWorker.url()).host;
      const extensionId = await readLoadedExtensionIdFromPreferences();
      if (extensionId) return extensionId;
      await delay(150);
    }
  } finally {
    await wakePage.close();
  }

  throw new Error("Pack extension did not appear in Chrome extension preferences.");
}

async function readLoadedExtensionIdFromPreferences() {
  const preferencesPath = path.join(profileDir, "Default", "Preferences");
  try {
    const preferences = JSON.parse(await readFile(preferencesPath, "utf8"));
    const extensionSettings = preferences.extensions?.settings ?? {};
    for (const [extensionId, settings] of Object.entries(extensionSettings)) {
      if (settings?.manifest?.name === "ComplyEaze Pack: GST Return Downloader") {
        return extensionId;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function waitForServiceWorker(browserContext, extensionId) {
  let [serviceWorker] = browserContext.serviceWorkers();
  if (!serviceWorker) {
    const wakePage = await browserContext.newPage();
    attachPageLogging(wakePage);
    await wakePage.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "domcontentloaded",
    });
    try {
      serviceWorker = await browserContext.waitForEvent("serviceworker", { timeout: 15_000 });
    } finally {
      await wakePage.close();
    }
  }
  return serviceWorker;
}

async function assertServiceWorkerStarted(serviceWorker) {
  const serviceWorkerState = await serviceWorker.evaluate(async () => {
    const manifest = chrome.runtime.getManifest();
    await chrome.storage.local.set({ "pack:browser-release-probe": { localOnly: true } });
    const values = await chrome.storage.local.get("pack:browser-release-probe");
    await chrome.storage.local.remove("pack:browser-release-probe");
    return {
      manifestName: manifest.name,
      storageWritable: Boolean(values["pack:browser-release-probe"]?.localOnly),
    };
  });
  if (serviceWorkerState.manifestName !== "ComplyEaze Pack: GST Return Downloader") {
    throw new Error("Unexpected extension manifest loaded in browser.");
  }
  if (!serviceWorkerState.storageWritable) {
    throw new Error("Extension service worker could not use local storage.");
  }
}

async function assertOptionsPageLoads(browserContext, extensionId) {
  const optionsPage = await browserContext.newPage();
  attachPageLogging(optionsPage);
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
  await optionsPage.waitForLoadState("domcontentloaded");
  const title = await optionsPage.title();
  if (title !== "ComplyEaze Pack Options") {
    throw new Error(`Unexpected options page title: ${title}`);
  }
  await optionsPage.close();
}

async function assertPopupPageLoads(browserContext, extensionId) {
  const popupPage = await browserContext.newPage();
  attachPageLogging(popupPage);
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.waitForLoadState("domcontentloaded");
  await popupPage.waitForSelector(".popup-shell", { timeout: 5_000 });
  await popupPage.waitForFunction(
    () =>
      document.body.textContent?.includes("Checking this tab") ||
      document.body.textContent?.includes("Open the GST Portal to use Pack") ||
      document.body.textContent?.includes("Sign in again on the GST Portal"),
    undefined,
    { timeout: 5_000 },
  );
  const popupState = await popupPage.evaluate(() => {
    const wordmark = document.querySelector(".popup-wordmark");
    const wordmarkRect = wordmark?.getBoundingClientRect();
    const visibleWordmark =
      wordmarkRect && wordmarkRect.width > 0 && wordmarkRect.height > 0
        ? document.elementFromPoint(
            wordmarkRect.left + wordmarkRect.width / 2,
            wordmarkRect.top + wordmarkRect.height / 2,
          )
        : null;
    return {
      title: document.title,
      shellRect: document.querySelector(".popup-shell")?.getBoundingClientRect().toJSON(),
      shellText: document.querySelector(".popup-shell")?.textContent ?? "",
      hasContextState: Boolean(document.querySelector(".context-state")),
      visibleWordmark: visibleWordmark?.getAttribute("alt") ?? "",
    };
  });
  if (popupState.title !== "ComplyEaze Pack") {
    throw new Error(`Unexpected popup page title: ${popupState.title}`);
  }
  if (
    !popupState.shellText.includes("Checking this tab") &&
    !popupState.shellText.includes("Open the GST Portal to use Pack") &&
    !popupState.shellText.includes("Sign in again on the GST Portal")
  ) {
    throw new Error("Pack popup did not render a valid context state.");
  }
  if (!popupState.visibleWordmark.includes("Pack by ComplyEaze")) {
    throw new Error("Pack popup mounted in the DOM but did not visibly paint its brand header.");
  }
  if (!popupState.hasContextState) {
    throw new Error("Pack popup did not render its context state.");
  }
  if (
    !popupState.shellRect ||
    popupState.shellRect.width < 380 ||
    popupState.shellRect.width > 460 ||
    popupState.shellRect.height < 180 ||
    popupState.shellRect.height > 700
  ) {
    throw new Error(
      `Pack popup shell rendered outside the expected compact size: ${JSON.stringify(
        popupState.shellRect,
      )}`,
    );
  }
  await popupPage.close();
}

async function assertApprovedContentScript(browserContext, serviceWorker) {
  const gstPage = await browserContext.newPage();
  attachPageLogging(gstPage);
  await gstPage.goto("https://services.gst.gov.in/services/auth/fowelcome", {
    waitUntil: "domcontentloaded",
  });
  await gstPage.waitForLoadState("networkidle");
  await waitForStoredContext(serviceWorker, {
    supported: true,
    pageKind: "gst-auth-landing",
    origin: "https://services.gst.gov.in",
  });
  await gstPage.close();
}

async function waitForStoredContext(serviceWorker, expected) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const stored = await serviceWorker.evaluate(async () => {
      const values = await chrome.storage.session.get("pack:last-context");
      return values["pack:last-context"] ?? null;
    });
    if (
      stored?.supported === expected.supported &&
      stored?.pageKind === expected.pageKind &&
      stored?.origin === expected.origin
    ) {
      return;
    }
    await delay(150);
  }
  throw new Error("Approved GST content script did not store expected context.");
}

async function assertHostilePageCannotMessageExtension(browserContext) {
  const hostilePage = await browserContext.newPage();
  attachPageLogging(hostilePage);
  await hostilePage.goto(`${hostileOrigin}/hostile-inputs`, {
    waitUntil: "domcontentloaded",
  });
  const canSendExternalMessage = await hostilePage.evaluate(() =>
    Boolean(globalThis.__packExternalMessageAvailable),
  );
  await hostilePage.close();
  if (canSendExternalMessage) {
    throw new Error("Hostile page can access chrome.runtime.sendMessage.");
  }
}

function assertDeniedUnexpectedNetwork() {
  const unexpectedDeniedRequests = deniedRequests.filter((request) => !request.expected);
  if (unexpectedDeniedRequests.length > 0) {
    throw new Error(
      `Browser release verifier denied unexpected network requests: ${unexpectedDeniedRequests
        .map((request) => request.url)
        .join(", ")}`,
    );
  }
  if (!deniedRequests.some((request) => request.expected)) {
    throw new Error(
      "Browser release verifier did not deny the synthetic unexpected network probe.",
    );
  }
}

function assertSanitizedBrowserLogs() {
  for (const entry of [...browserLogs, ...pageErrors, ...requestFailures]) {
    for (const { id, pattern } of sensitivePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(entry.raw)) {
        throw new Error(`Unsanitized browser log contains ${id}.`);
      }
    }
  }
}

function assertNoBrowserRuntimeFailures() {
  if (pageErrors.length > 0) {
    throw new Error(
      `Browser release verifier observed page errors: ${pageErrors
        .map((entry) => entry.redacted)
        .join(", ")}`,
    );
  }
  if (requestFailures.length > 0) {
    throw new Error(
      `Browser release verifier observed unexpected request failures: ${requestFailures
        .map((entry) => entry.redacted)
        .join(", ")}`,
    );
  }
}

function syntheticGstPage(url) {
  return `<!doctype html>
    <html>
      <head>
        <title>GST Portal</title>
      </head>
      <body>
        <main>
          <h1>GST Portal synthetic release page</h1>
          <button>View Filed Returns</button>
          <img alt="" src="${expectedDeniedNetworkProbe}" />
          <script>console.info("pack release synthetic page loaded");</script>
          <p data-source="${sanitize(url)}">Synthetic only.</p>
        </main>
      </body>
    </html>`;
}

function hostilePageHtml() {
  return `<!doctype html>
    <html>
      <head>
        <title>Hostile Pack Synthetic Page</title>
      </head>
      <body>
        <main>
          <h1>Hostile synthetic page</h1>
          <input name="gstin" value="29ABCDE1234F1Z5" />
          <script>window.__packExternalMessageAvailable = Boolean(globalThis.chrome?.runtime?.sendMessage);</script>
        </main>
      </body>
    </html>`;
}

function attachPageLogging(page) {
  page.on("console", (message) => {
    recordBrowserEvent(browserLogs, `${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    recordBrowserEvent(pageErrors, error.message);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url === expectedDeniedNetworkProbe) return;
    recordBrowserEvent(requestFailures, url);
  });
}

function recordBrowserEvent(target, raw) {
  target.push({
    raw,
    redacted: sanitize(raw),
  });
}

function sanitize(value) {
  return sensitivePatterns.reduce(
    (text, { id, pattern }) => text.replace(pattern, `<${id}>`),
    value,
  );
}

function isExpectedDeniedNetworkProbe(url) {
  return url === expectedDeniedNetworkProbe;
}

function ensureHeadedChromiumDisplay() {
  const needsDisplay =
    process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  if (!needsDisplay || process.env.PACK_BROWSER_XVFB === "1") return;

  const result = spawnSync(
    "xvfb-run",
    ["--auto-servernum", process.execPath, ...process.argv.slice(1)],
    {
      env: { ...process.env, PACK_BROWSER_XVFB: "1" },
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw new Error(
      "Pack browser release verification requires a display for headed Chromium extension loading. Install xvfb-run or run this verifier inside a headed browser environment.",
    );
  }
  process.exit(result.status ?? 1);
}

function isChromiumCrashpadPermissionFailure(message) {
  return (
    /Crashpad\/settings\.dat/i.test(message) &&
    /Operation not permitted|Permission denied/i.test(message)
  );
}

function redactExtensionId(value) {
  return value.replace(/[a-z]{32}/g, "<extension-id>");
}

function symbolic(value) {
  return value.replace(process.cwd(), "<PACK_ROOT>");
}

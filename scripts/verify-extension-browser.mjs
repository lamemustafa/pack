#!/usr/bin/env node
/* global chrome, document, window */
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
  await assertPanelPageLoads(context, extensionId);
  await assertPanelSignInContext(context, extensionId);
  await assertPanelCompactFlow(context, extensionId);
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
  const existingServiceWorker = findExtensionServiceWorker(browserContext);
  if (existingServiceWorker) return new URL(existingServiceWorker.url()).host;

  const wakePage = await browserContext.newPage();
  attachPageLogging(wakePage);
  await wakePage.goto("https://services.gst.gov.in/services/auth/fowelcome", {
    waitUntil: "domcontentloaded",
  });
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const serviceWorker = findExtensionServiceWorker(browserContext);
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
  let serviceWorker = findExtensionServiceWorker(browserContext, extensionId);
  if (!serviceWorker) {
    const wakePage = await browserContext.newPage();
    attachPageLogging(wakePage);
    const serviceWorkerEvent = browserContext
      .waitForEvent("serviceworker", {
        predicate: (worker) => isExtensionServiceWorker(worker, extensionId),
        timeout: 15_000,
      })
      .catch(() => null);
    try {
      await wakePage.goto(`chrome-extension://${extensionId}/panel.html`, {
        waitUntil: "domcontentloaded",
      });
      serviceWorker =
        findExtensionServiceWorker(browserContext, extensionId) ?? (await serviceWorkerEvent);
    } finally {
      await wakePage.close();
    }
  }
  if (!serviceWorker) throw new Error("Pack extension service worker did not start.");
  return serviceWorker;
}

function findExtensionServiceWorker(browserContext, extensionId) {
  return browserContext
    .serviceWorkers()
    .find((worker) => isExtensionServiceWorker(worker, extensionId));
}

function isExtensionServiceWorker(worker, extensionId) {
  try {
    const workerUrl = new URL(worker.url());
    return (
      workerUrl.protocol === "chrome-extension:" && (!extensionId || workerUrl.host === extensionId)
    );
  } catch {
    return false;
  }
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

/**
 * Loads the panel page out of the packaged extension and proves it painted.
 *
 * This asserted the popup until the popup folded into the panel. Every
 * assertion in it was popup-specific -- `.popup-shell`, the `.popup-wordmark`
 * alt text, and a title the panel does not use -- so pointing it at
 * `panel.html` without rewriting them turned a passing gate into a timeout.
 * Rendering is checked through the brand mark's own paint rather than its alt
 * text, because the mark is decorative (`alt=""`, `aria-hidden`) and an alt
 * assertion would have been asserting a string this surface deliberately
 * does not carry.
 */
async function assertPanelPageLoads(browserContext, extensionId) {
  const panelPage = await browserContext.newPage();
  attachPageLogging(panelPage);
  await panelPage.setViewportSize({ width: 320, height: 900 });
  await panelPage.goto(`chrome-extension://${extensionId}/panel.html`);
  await panelPage.waitForLoadState("domcontentloaded");
  await panelPage.waitForSelector(".panel-shell", { timeout: 5_000 });
  await panelPage.waitForFunction(
    () =>
      document.body.textContent?.includes("Checking this tab") ||
      document.body.textContent?.includes("Open the GST Portal to use Pack") ||
      document.body.textContent?.includes("Sign in again on the GST Portal"),
    undefined,
    { timeout: 5_000 },
  );
  const panelState = await panelPage.evaluate(() => {
    const mark = document.querySelector(".panel-mark");
    const markRect = mark?.getBoundingClientRect();
    // Present in the DOM is not painted. `elementFromPoint` at the mark's own
    // centre is what separates a rendered asset from a broken or covered one.
    const paintedMark =
      markRect && markRect.width > 0 && markRect.height > 0
        ? document.elementFromPoint(
            markRect.left + markRect.width / 2,
            markRect.top + markRect.height / 2,
          )
        : null;
    return {
      title: document.title,
      viewportWidth: window.innerWidth,
      shellRect: document.querySelector(".panel-shell")?.getBoundingClientRect().toJSON(),
      shellText: document.querySelector(".panel-shell")?.textContent ?? "",
      hasContextState: Boolean(document.querySelector(".context-state")),
      markPainted: paintedMark === mark,
      // elementFromPoint only proves the <img> owns its CSS-sized hit box, and
      // panel.css gives that box fixed dimensions whether or not the SVG
      // decodes. A corrupt asset with nonzero bytes passes the package check and
      // would have passed this one too, while Chrome shows a broken image.
      markDecoded: Boolean(mark && mark.complete && mark.naturalWidth > 0),
      markSource: mark?.getAttribute("src") ?? "",
    };
  });
  if (panelState.title !== "Pack") {
    throw new Error(`Unexpected panel page title: ${panelState.title}`);
  }
  if (
    !panelState.shellText.includes("Checking this tab") &&
    !panelState.shellText.includes("Open the GST Portal to use Pack") &&
    !panelState.shellText.includes("Sign in again on the GST Portal")
  ) {
    throw new Error("Pack panel did not render a valid context state.");
  }
  if (!panelState.markPainted || !panelState.markSource.includes("pack-mark")) {
    throw new Error("Pack panel mounted in the DOM but did not visibly paint its brand mark.");
  }
  if (!panelState.markDecoded) {
    throw new Error(
      "Pack panel brand mark did not decode; the packaged asset is not a usable image.",
    );
  }
  if (!panelState.hasContextState) {
    throw new Error("Pack panel did not render its context state.");
  }
  await assertPanelControlsFitViewport(panelPage, "checking or unavailable context");
  if (
    !panelState.shellRect ||
    panelState.shellRect.width < Math.min(300, panelState.viewportWidth - 32) ||
    panelState.shellRect.height < 180
  ) {
    throw new Error(
      `Pack panel shell rendered smaller than a usable surface: ${JSON.stringify(
        panelState.shellRect,
      )}`,
    );
  }
  await panelPage.close();
}

/**
 * The side panel's narrowest supported width is 320px. Exercise the actual
 * packaged page after the synthetic GST content script has supplied its
 * supported context, so both the preset choices and the expanded declared
 * catalogue must fit without a clipped control or horizontal scroll.
 */
async function assertPanelCompactFlow(browserContext, extensionId) {
  const gstPage = await browserContext.newPage();
  attachPageLogging(gstPage);
  const panelPage = await browserContext.newPage();
  attachPageLogging(panelPage);
  try {
    await gstPage.goto("https://return.gst.gov.in/returns/auth/efiledreturns", {
      waitUntil: "domcontentloaded",
    });
    const serviceWorker = await waitForServiceWorker(browserContext, extensionId);
    await waitForStoredContext(serviceWorker, {
      supported: true,
      pageKind: "gst-filed-returns",
      origin: "https://return.gst.gov.in",
    });

    await panelPage.setViewportSize({ width: 320, height: 900 });
    await panelPage.goto(`chrome-extension://${extensionId}/panel.html`);
    await panelPage.waitForSelector(".panel-presets", { timeout: 5_000 });
    await assertPanelControlsFitViewport(panelPage, "preset choices");

    await panelPage.getByRole("button", { name: "Choose return, year and period" }).click();
    await panelPage.waitForSelector(".panel-guide", { timeout: 5_000 });
    await assertPanelGuidedStepsFitViewport(panelPage);
    const catalogueSummary = panelPage.locator(".panel-catalogue summary");
    await catalogueSummary.press("Space");
    await panelPage.waitForSelector(".panel-catalogue[open]", { timeout: 5_000 });
    await assertPanelControlsFitViewport(panelPage, "expanded catalogue");
  } finally {
    await panelPage.close();
    await gstPage.close();
  }
}

async function assertPanelGuidedStepsFitViewport(panelPage) {
  for (let step = 1; step <= 4; step += 1) {
    await panelPage.getByRole("status", { name: `Step ${step} of 4` }).waitFor();
    if (step > 1) {
      const focusedField = await panelPage.evaluate(
        () => document.activeElement?.id === "panel-guide-field",
      );
      if (!focusedField) {
        throw new Error(`Pack panel did not focus guided step ${step} at 320px.`);
      }
    }
    await assertPanelControlsFitViewport(panelPage, `guided step ${step} of 4`);
    if (step < 4) await panelPage.getByRole("button", { name: "Continue" }).click();
  }
}

/**
 * The authenticated landing route is supported enough to remain the selected
 * GST tab, but without its authenticated markers it must render the terminal
 * sign-in state rather than a ready chooser. Check that packaged path at the
 * side panel's narrowest supported width.
 */
async function assertPanelSignInContext(browserContext, extensionId) {
  const gstPage = await browserContext.newPage();
  attachPageLogging(gstPage);
  const panelPage = await browserContext.newPage();
  attachPageLogging(panelPage);
  try {
    await gstPage.goto("https://services.gst.gov.in/services/auth/fowelcome", {
      waitUntil: "domcontentloaded",
    });
    const serviceWorker = await waitForServiceWorker(browserContext, extensionId);
    await waitForStoredContext(serviceWorker, {
      supported: true,
      pageKind: "gst-auth-landing",
      origin: "https://services.gst.gov.in",
    });

    await panelPage.setViewportSize({ width: 320, height: 900 });
    await panelPage.goto(`chrome-extension://${extensionId}/panel.html`);
    await panelPage.getByRole("heading", { name: "Sign in on GST Portal" }).waitFor();
    await panelPage.getByRole("button", { name: "Open GST Portal sign-in" }).waitFor();
    await assertPanelControlsFitViewport(panelPage, "sign-in context");
  } finally {
    await panelPage.close();
    await gstPage.close();
  }
}

async function assertPanelControlsFitViewport(panelPage, state) {
  const geometry = await panelPage.evaluate(() => {
    const shell = document.querySelector(".panel-shell")?.getBoundingClientRect();
    const controls = [
      ...document.querySelectorAll(
        ".panel-shell button, .panel-shell select, .panel-shell summary",
      ),
    ].map((control) => {
      const rect = control.getBoundingClientRect();
      return {
        label: control.textContent?.trim() || control.getAttribute("aria-label") || control.tagName,
        height: rect.height,
        left: rect.left,
        right: rect.right,
      };
    });
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      shell: shell?.toJSON() ?? null,
      controls,
    };
  });
  if (!geometry.shell) throw new Error(`Pack panel shell is absent at 320px during ${state}.`);
  if (geometry.documentWidth > geometry.viewportWidth) {
    throw new Error(
      `Pack panel introduced horizontal document scrolling at 320px during ${state}: ${geometry.documentWidth}px > ${geometry.viewportWidth}px.`,
    );
  }
  const clippedControl = geometry.controls.find(
    (control) =>
      control.left < geometry.shell.x || control.right > geometry.shell.x + geometry.shell.width,
  );
  if (clippedControl) {
    throw new Error(
      `Pack panel clipped a control at 320px during ${state}: ${clippedControl.label}.`,
    );
  }
  const undersizedControl = geometry.controls.find((control) => control.height < 44);
  if (undersizedControl) {
    throw new Error(
      `Pack panel rendered a control shorter than 44px at 320px during ${state}: ${undersizedControl.label}.`,
    );
  }
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
          <input name="gstin" value="00XXXXX0000X0Z0" />
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

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsFlowSummary,
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import { FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND } from "../../src/connectors/gst/filed-returns-contracts";
import type { PackMessage, PackMessageResponse } from "../../src/connectors/gst/messages";
import {
  canonicalDurableSummaryMessage,
  canonicalDurableTargetStatus,
} from "../../src/connectors/gst/filed-returns-durable-status";
import { filedReturnsScopeId } from "../../src/connectors/gst/filed-returns-return-types";
import {
  FULL_FISCAL_YEAR_PERIOD,
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsFullFiscalYearPeriods,
} from "../../src/connectors/gst/filed-returns-scope";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { PACK_CLEAR_LOCAL_DATA_ACTION_LABEL } from "../../src/core/recovery-actions";
import { acquireFiledReturnsRun } from "../../src/background/filed-returns-active-run";
import {
  createFullFiscalYearLedger,
  markFullFiscalYearTargetRunning,
  markFullFiscalYearTargetTerminal,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import {
  persistLedger,
  readLedgerById,
} from "../../src/background/filed-returns-full-fiscal-year-run-state";
import {
  createAllSupportedFullFiscalYearLedger,
  markAllSupportedFullFiscalYearTargetTerminal,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-ledger";
import type {
  FiledReturnsAllSupportedFullFiscalYearLedger,
  FiledReturnsAllSupportedFullFiscalYearTarget,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";
import {
  persistAllSupportedFullFiscalYearLedger,
  readAllSupportedFullFiscalYearLedgerById,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-run-state";
import { filedReturnsStorageKeys } from "../../src/background/storage-keys";
import type * as FullYearZipModule from "../../src/background/filed-returns-full-fiscal-year-zip";

/**
 * Four suspected recovery dead ends, each driven end to end: the real panel and the real popup
 * controller, talking through `browser.runtime.sendMessage` to the real background entrypoint's
 * message listener, over one in-memory `browser.storage` that raises `onChanged` like Chrome does.
 * Nothing between the click and the rendered text is stubbed except what a unit test cannot host:
 *
 * - `PACK_GET_CONTEXT` answers a signed-in filed-returns page. The portal is not the subject here,
 *   and every action exercised below refuses or resolves before it would touch a GST tab.
 * - OPFS and the offscreen ZIP writer. `exportFullFiscalYearZip` is a spy, so an attempted export
 *   is observable, and discarding staged files reports success. Exact-ID ZIP reconciliation stays
 *   real and asks `chrome.downloads.search`, which here knows no downloads.
 *
 * AGENTS.md: "Every terminal state renders a user-visible safeMessage; a silent no-op is a bug."
 * Each test asserts what the reader sees, and whether a control they can see is accepted.
 */

type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type Listener = (changes: StorageChanges, area: string) => void;
type BackgroundListener = (
  message: unknown,
  sender: { id: string },
  sendResponse: (response: PackMessageResponse) => void,
) => boolean | undefined;

const env = vi.hoisted(() => {
  const state = {
    local: {} as Record<string, unknown>,
    session: {} as Record<string, unknown>,
    listeners: new Set<Listener>(),
    background: null as BackgroundListener | null,
    inFlight: 0,
  };
  const copy = <T,>(value: T): T =>
    value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
  const emit = (changes: StorageChanges, area: string) => {
    if (Object.keys(changes).length === 0) return;
    queueMicrotask(() => {
      for (const listener of state.listeners) listener(changes, area);
    });
  };
  const area = (name: "local" | "session") => ({
    get: async (keys?: string | string[] | Record<string, unknown> | null) => {
      const values = state[name];
      if (typeof keys === "string") return keys in values ? { [keys]: copy(values[keys]) } : {};
      if (Array.isArray(keys)) {
        return Object.fromEntries(
          keys.filter((key) => key in values).map((key) => [key, copy(values[key])]),
        );
      }
      if (keys && typeof keys === "object") {
        return Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [
            key,
            key in values ? copy(values[key]) : fallback,
          ]),
        );
      }
      return copy(values);
    },
    set: async (items: Record<string, unknown>) => {
      const changes: StorageChanges = {};
      for (const [key, value] of Object.entries(items)) {
        // Like Chrome, a write that leaves a value unchanged raises no change for it.
        if (JSON.stringify(state[name][key]) !== JSON.stringify(value)) {
          changes[key] = { oldValue: state[name][key], newValue: copy(value) };
        }
        state[name][key] = copy(value);
      }
      emit(changes, name);
    },
    remove: async (keys: string | string[]) => {
      const changes: StorageChanges = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (!(key in state[name])) continue;
        changes[key] = { oldValue: state[name][key] };
        delete state[name][key];
      }
      emit(changes, name);
    },
    clear: async () => {
      const changes: StorageChanges = {};
      for (const key of Object.keys(state[name])) changes[key] = { oldValue: state[name][key] };
      state[name] = {};
      emit(changes, name);
    },
    setAccessLevel: async () => undefined,
  });
  const noopEvent = { addListener: () => undefined, removeListener: () => undefined };
  const browser = {
    downloads: {
      // Chrome no longer knows the saved final-ZIP download ID (D2's premise).
      search: async () => [],
      onChanged: noopEvent,
      onCreated: noopEvent,
    },
    runtime: {
      id: "pack-test-extension",
      getManifest: () => ({ version: "0.0.0-test" }),
      getURL: (path: string) => `chrome-extension://pack/${path}`,
      onInstalled: noopEvent,
      onMessage: {
        addListener: (listener: BackgroundListener) => {
          state.background = listener;
        },
        removeListener: () => undefined,
      },
      sendMessage: (message: { type?: string }) => {
        if (message?.type === "PACK_GET_CONTEXT") {
          return Promise.resolve({
            ok: true,
            context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
          });
        }
        const listener = state.background;
        if (!listener) return Promise.reject(new Error("The background worker is not running."));
        state.inFlight += 1;
        return new Promise((resolve) => {
          const keepsChannelOpen = listener(message, { id: "pack-test-extension" }, (response) => {
            state.inFlight -= 1;
            resolve(response);
          });
          if (keepsChannelOpen !== true) {
            state.inFlight -= 1;
            resolve(undefined);
          }
        });
      },
    },
    storage: {
      local: area("local"),
      session: area("session"),
      onChanged: {
        addListener: (listener: Listener) => state.listeners.add(listener),
        removeListener: (listener: Listener) => state.listeners.delete(listener),
      },
    },
    tabs: {
      create: async () => undefined,
      // The saved plan's pinned GST tab no longer exists (D4's premise); nothing else is open.
      get: async () => {
        throw new Error("No tab with that id.");
      },
      query: async () => [],
      onActivated: noopEvent,
      onUpdated: noopEvent,
    },
  };
  return { browser, state };
});

const zip = vi.hoisted(() => ({
  exportFullFiscalYearZip: vi.fn(),
  discardFullFiscalYearFiledReturnsZip: vi.fn(),
}));

vi.mock("wxt/browser", () => ({ browser: env.browser }));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", async (importOriginal) => {
  const actual = await importOriginal<typeof FullYearZipModule>();
  return {
    ...actual,
    exportFullFiscalYearZip: zip.exportFullFiscalYearZip,
    discardFullFiscalYearFiledReturnsZip: zip.discardFullFiscalYearFiledReturnsZip,
  };
});

import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { usePackPopupController } from "../../src/entrypoints/popup/use-pack-popup-controller";
import { panelController } from "./panel-controller.test-helpers";

const STORAGE_KEYS = filedReturnsStorageKeys();
/** Older than every staleness window (ledger 30s, lease 30s), so the worker is demonstrably gone. */
const STALE_BY_MS = 10 * 60_000;

let dom: JSDOM;
let root: Root | null = null;
let container: HTMLElement;

function PanelHarness() {
  return <PanelSurface pack={usePackPopupController()} />;
}

async function startWorker() {
  vi.stubGlobal("defineBackground", (entrypoint: () => void) => {
    entrypoint();
    return entrypoint;
  });
  await import("../../src/entrypoints/background");
  expect(env.state.background).not.toBeNull();
  await settle();
}

async function mountPanel() {
  root = createRoot(container);
  await act(async () => {
    root?.render(<PanelHarness />);
  });
  await settle();
}

/** Lets every in-flight message, storage event and resulting render finish. */
async function settle() {
  let quiet = 0;
  for (let round = 0; round < 200 && quiet < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    quiet = env.state.inFlight === 0 ? quiet + 1 : 0;
  }
}

function panelText(): string {
  return container.textContent ?? "";
}

function visibleButtons(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

function buttonLabels(): string[] {
  return visibleButtons().map((button) => button.textContent ?? "");
}

function findButton(pattern: RegExp): HTMLButtonElement | undefined {
  return visibleButtons().find((button) => pattern.test(button.textContent ?? ""));
}

/** The recovery options are a collapsed disclosure; a reader opens it to see what is inside. */
async function openRecoveryOptions() {
  for (const details of container.querySelectorAll<HTMLDetailsElement>(
    "details.recovery-details",
  )) {
    if (details.open) continue;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(
        new (dom.window as unknown as { Event: typeof Event }).Event("toggle", { bubbles: true }),
      );
    });
  }
  await settle();
}

async function click(button: HTMLButtonElement) {
  expect(button.disabled, `"${button.textContent}" is visible but disabled`).toBe(false);
  await act(async () => {
    button.click();
  });
  await settle();
}

async function sendAsReader(message: PackMessage): Promise<PackMessageResponse> {
  return (await env.browser.runtime.sendMessage(message)) as PackMessageResponse;
}

/** The Options page is the reader's other surface; its clear control is a real way out. */
async function clearLocalDataFromOptions(): Promise<string> {
  const { OptionsPage } = await import("../../src/entrypoints/options/main");
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const optionsRoot = createRoot(host);
  await act(async () => {
    optionsRoot.render(<OptionsPage />);
  });
  const clear = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === PACK_CLEAR_LOCAL_DATA_ACTION_LABEL,
  );
  expect(clear, "the Options page offers the local-data clear").toBeDefined();
  await act(async () => {
    clear!.click();
  });
  await settle();
  const status = host.querySelector('[role="status"]')?.textContent ?? host.textContent ?? "";
  await act(async () => optionsRoot.unmount());
  host.remove();
  return status;
}

/** Returning to the panel page: the controller re-reads the saved run, as it does live. */
async function returnToPanel() {
  await act(async () => {
    dom.window.dispatchEvent(new (dom.window as unknown as { Event: typeof Event }).Event("focus"));
  });
  await settle();
}

function currentFinancialYear(): string {
  return getFiledReturnsFinancialYearOptions(new Date())[0]!;
}

function singleReturnScope(): FiledReturnsDownloadScope {
  return {
    financialYear: currentFinancialYear(),
    period: FULL_FISCAL_YEAR_PERIOD,
    returnType: "GSTR-3B",
    artifactType: "PDF",
  };
}

function downloadedTargets(
  ledger: FiledReturnsFullFiscalYearLedger,
  at: Date,
): FiledReturnsFullFiscalYearLedger["targets"] {
  return ledger.targets.map((target, index) => ({
    ...target,
    status: "downloaded" as const,
    attempts: 1,
    ...canonicalDurableTargetStatus(
      {
        artifactType: "PDF",
        financialYear: target.financialYear,
        period: target.period,
        returnType: "GSTR-3B",
      },
      "downloaded",
      ["filed-return-artifact-downloaded:PDF", "full-fiscal-year-opfs-staged:PDF"],
    ),
    completedAt: at.toISOString(),
    downloadDiagnostic: {
      actionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      artifactType: "PDF",
      byteCountClass: "non-empty",
      downloadPathClass: "captured-portal-request-data",
      endpointClass: "gstr3b-portal-blob-captured-download",
      eventType: "filed-return-download-path",
      financialYear: target.financialYear,
      mimeClass: "pdf",
      period: target.period,
      returnType: "GSTR-3B",
      schemaVersion: "1.0",
      status: "downloaded",
    },
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("MODE", "source-surfaces");
  env.state.local = {};
  env.state.session = {};
  env.state.listeners.clear();
  env.state.background = null;
  env.state.inFlight = 0;
  zip.exportFullFiscalYearZip.mockReset();
  zip.exportFullFiscalYearZip.mockImplementation(
    async (_ledger: unknown, completeStep: PortalFlowStepResult) => ({
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        "full-fiscal-year-zip-export-failed",
        "full-fiscal-year-opfs-retained",
      ],
      safeMessage: "Synthetic export stop: the test records that an export was attempted.",
    }),
  );
  zip.discardFullFiscalYearFiledReturnsZip.mockReset();
  zip.discardFullFiscalYearFiledReturnsZip.mockResolvedValue(["full-fiscal-year-opfs-cleared"]);
  dom = new JSDOM("<div id='panel-root'></div>", {
    pretendToBeVisual: true,
    url: "https://extension.test",
  });
  Object.assign(globalThis, { document: dom.window.document, window: dom.window });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = dom.window.document.getElementById("panel-root") as HTMLElement;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  await settle();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * D1. The worker died while a single-return full-year period was `running`: the ledger and its
 * run lease are both stale. The panel offers "Retry {period}"; the background always refuses a
 * running target with `full-fiscal-year-run-interrupted`, and builds the refusal's summary from
 * the stale ledger as stored.
 */
describe("D1: retrying a period the worker died on", () => {
  async function seedInterruptedRun() {
    const stoppedAt = new Date(Date.now() - STALE_BY_MS);
    const scope = singleReturnScope();
    const created = createFullFiscalYearLedger(
      scope,
      stoppedAt,
      getFiledReturnsFullFiscalYearPeriods(scope.financialYear, new Date(), scope.returnType),
    );
    const ledger = markFullFiscalYearTargetRunning(
      created,
      created.targets[0]!.targetId,
      stoppedAt,
    );
    await persistLedger({ storageKeys: STORAGE_KEYS }, ledger);
    // The dead worker's lease, never released.
    const lease = await acquireFiledReturnsRun(scope, {
      storageKeys: { activeRun: STORAGE_KEYS.activeRun },
      now: () => stoppedAt,
    });
    expect("run" in lease).toBe(true);
    return { ledger, period: ledger.targets[0]!.period };
  }

  /** The reader first clears the dead worker's lease, which is what the panel asks of them. */
  async function reachFullYearRecovery(period: string) {
    await openRecoveryOptions();
    const clearLease = findButton(/^Clear interrupted run$/);
    if (clearLease) {
      await click(clearLease);
      await openRecoveryOptions();
    }
    expect(panelText()).toContain(`Pack stopped before it could confirm the result for ${period}.`);
  }

  it("leaves the reader a visible reason and a way on after the retry is refused", async () => {
    const { ledger, period } = await seedInterruptedRun();
    await startWorker();
    await mountPanel();
    await reachFullYearRecovery(period);

    const retry = findButton(new RegExp(`^Retry ${period}$`));
    if (retry) {
      await click(retry);
      await openRecoveryOptions();

      // The refusal happened: nothing was reset or replayed.
      const stored = await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId);
      expect(stored?.targets[0]?.status).toBe("running");
      expect(zip.exportFullFiscalYearZip).not.toHaveBeenCalled();

      // What the reader must see after a refusal: why, and a way to move on -- not a live run.
      expect(panelText()).not.toContain("Packing your files");
      expect(panelText()).not.toContain("Run in progress");
      expect(panelText()).toContain(
        "Pack cannot safely retry an interrupted period because a staged file may exist without its final ledger checkpoint.",
      );
      expect(buttonLabels()).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^(Cancel and reset|Discard saved run and start selected download)$/,
          ),
        ]),
      );
    }

    // Either the retry was never offered, or it was refused -- in both cases the reader can still
    // leave, and the control that says so is accepted by the background.
    const leave = findButton(/^Cancel and reset$/);
    expect(leave, `no way out among: ${JSON.stringify(buttonLabels())}`).toBeDefined();
    await click(leave!);
    expect(await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId)).toBeNull();
    expect(panelText()).toContain("The previous recovery state was cleared.");
  });

  it("shows a refused retry as a stopped run with its reason, never as a live one", async () => {
    // A panel still showing an older offer can send the retry the current panel withholds; the
    // background's answer is what the reader then sees.
    const { ledger, period } = await seedInterruptedRun();
    // The reader has already cleared the dead worker's lease, as the panel asks them to.
    delete env.state.local[STORAGE_KEYS.activeRun];
    await startWorker();
    const response = await sendAsReader({
      type: "PACK_RETRY_FULL_FISCAL_YEAR_TARGET",
      payload: {
        ledgerId: ledger.ledgerId,
        targetId: ledger.targets[0]!.targetId,
        expectedRevision: ledger.revision ?? 1,
      },
    });

    expect(response).toMatchObject({ ok: true, flowSummary: { status: "blocked" } });
    const refused = (response as { flowSummary: FiledReturnsFlowSummary }).flowSummary;
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PanelSurface
          pack={panelController({ scopedFlowSummary: refused, lastRunSummary: refused })}
        />,
      );
    });
    await openRecoveryOptions();

    expect(panelText()).not.toContain("Packing your files");
    expect(panelText()).toContain(
      "Pack cannot safely retry an interrupted period because a staged file may exist without its final ledger checkpoint.",
    );
    expect(findButton(new RegExp(`^Retry ${period}$`))).toBeUndefined();
    expect(findButton(/^Cancel and reset$/)).toBeDefined();
    // Nothing was reset or replayed.
    const stored = await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId);
    expect(stored?.targets[0]?.status).toBe("running");
  });

  it("accepts Cancel and reset for the interrupted period when no retry was attempted first", async () => {
    // Coverage for the exit D1's refusal hides: on its own, the discard control works.
    const { ledger, period } = await seedInterruptedRun();
    await startWorker();
    await mountPanel();
    await reachFullYearRecovery(period);

    expect(panelText()).not.toContain("Packing your files");
    const cancel = findButton(/^Cancel and reset$/);
    expect(cancel, JSON.stringify(buttonLabels())).toBeDefined();
    await click(cancel!);

    expect(zip.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(ledger.ledgerId);
    expect(await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId)).toBeNull();
    expect(panelText()).toContain("The previous recovery state was cleared.");
  });
});

/**
 * D2. The final fiscal-year ZIP was handed to the browser and its download ID saved, but Chrome
 * no longer knows that ID. Worker start reconciles it by ID, cannot confirm it, and moves the
 * ledger to `download-intent-persisted` without the ID. The reader is told to check Downloads and
 * offered "I checked—retry final ZIP".
 */
describe("D2: a final ZIP whose browser download ID is gone", () => {
  async function seedObservingZip() {
    const handedOffAt = new Date(Date.now() - STALE_BY_MS);
    const scope = singleReturnScope();
    const created = createFullFiscalYearLedger(
      scope,
      handedOffAt,
      getFiledReturnsFullFiscalYearPeriods(scope.financialYear, new Date(), scope.returnType),
    );
    const ledger: FiledReturnsFullFiscalYearLedger = {
      ...created,
      revision: 5,
      status: "blocked",
      updatedAt: handedOffAt.toISOString(),
      zipPhase: "download-observing",
      zipDownloadAttempt: { downloadId: 481, requestedAt: handedOffAt.toISOString() },
      targets: downloadedTargets(created, handedOffAt),
    };
    delete ledger.currentTargetId;
    await persistLedger({ storageKeys: STORAGE_KEYS }, ledger);
    return ledger;
  }

  /** The saved run's own scope is the guided form's; its last step carries the action. */
  async function openGuidedAction(): Promise<HTMLButtonElement | undefined> {
    const door = findButton(/Choose return, year and period/);
    if (door) await click(door);
    for (let step = 0; step < 8; step += 1) {
      const action = findButton(/final ZIP/);
      if (action) return action;
      const next = findButton(/^Continue$/);
      if (!next) break;
      await click(next);
    }
    return findButton(/final ZIP/);
  }

  it("rebuilds the final ZIP only on the explicit confirmation, repeating no portal work", async () => {
    const ledger = await seedObservingZip();
    await startWorker();
    const attemptsBefore = ledger.targets.map((target) => target.attempts);

    // A plain start is not the confirmation: the ambiguous handoff stays in review.
    await sendAsReader({ type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW", payload: ledger.scope });
    expect(zip.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect((await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId))?.zipPhase).toBe(
      "download-intent-persisted",
    );

    await mountPanel();
    const checked = await openGuidedAction();
    expect(checked?.textContent).toBe("I checked—retry final ZIP");
    await click(checked!);

    expect(zip.exportFullFiscalYearZip).toHaveBeenCalledTimes(1);
    const exported = zip.exportFullFiscalYearZip.mock
      .calls[0]![0] as FiledReturnsFullFiscalYearLedger;
    expect(exported.ledgerId).toBe(ledger.ledgerId);
    // Pack's own archive was rebuilt from staging; no period was fetched again.
    const stored = await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId);
    expect(stored?.targets.map((target) => target.attempts)).toEqual(attemptsBefore);
    expect(stored?.targets.every((target) => target.status === "downloaded")).toBe(true);
  });

  it("gives the reader a way out after they confirm they checked Downloads", async () => {
    const ledger = await seedObservingZip();
    await startWorker();

    // Worker start reconciled the exact ID and could not find it.
    const reconciled = await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId);
    expect(reconciled?.zipPhase).toBe("download-intent-persisted");
    expect(reconciled?.zipDownloadAttempt?.downloadId).toBeUndefined();

    await mountPanel();
    expect(panelText()).toContain("Final ZIP may already have started · check Browser Downloads");

    const checked = await openGuidedAction();
    expect(checked?.textContent, JSON.stringify(buttonLabels())).toBe("I checked—retry final ZIP");
    await click(checked!);
    const afterCheckedText = panelText();
    const afterCheckedLabels = buttonLabels();

    const pathsOut: string[] = [];
    // (a) The explicit "I checked" confirmation lets Pack build the ZIP again.
    if (zip.exportFullFiscalYearZip.mock.calls.length > 0) {
      pathsOut.push("new ZIP export attempted");
    }

    // (b) The panel shows a discard or cancel control, and the background accepts it.
    await openRecoveryOptions();
    const discard = findButton(/discard|cancel|reset/i);
    if (discard && !discard.disabled) {
      await click(discard);
      if (!(await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId))) {
        pathsOut.push(`panel control accepted: ${discard.textContent}`);
      }
    }

    // (c) The Options page's local-data clear is accepted for this saved run.
    const optionsStatus = await clearLocalDataFromOptions();
    if (optionsStatus.includes("Pack local and session storage keys cleared.")) {
      pathsOut.push("Options clear accepted");
    }

    expect(
      pathsOut,
      [
        "After 'I checked—retry final ZIP' the reader has no accepted way out.",
        `Panel after the confirmation: ${afterCheckedText}`,
        `Controls: ${JSON.stringify(afterCheckedLabels)}`,
        `Options said: ${optionsStatus}`,
      ].join("\n"),
    ).not.toEqual([]);
  });
});

/**
 * D3. An all-returns plan saved a final-ZIP download intent (`download-intent-persisted`) before
 * the worker stopped. No exact download ID exists, so the runner will not replay the ZIP.
 */
describe("D3: an all-returns plan stopped at a final-ZIP download intent", () => {
  async function seedIntentPlan() {
    const at = new Date(Date.now() - STALE_BY_MS);
    const financialYear = getFiledReturnsFinancialYearOptions(new Date())[1]!;
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected the all-supported return plan");
    const created = createAllSupportedFullFiscalYearLedger(
      { kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND, financialYear },
      expansion.targets,
      ["April"],
      at,
    );
    const staged = created.targets.reduce(
      (ledger, target, index) =>
        markAllSupportedFullFiscalYearTargetTerminal(
          ledger,
          target.targetId,
          "downloaded",
          stagedAllSupportedStep(target),
          new Date(at.getTime() + (index + 1) * 1_000),
        ),
      created,
    );
    const intentAt = new Date(at.getTime() + 60_000);
    const ledger: FiledReturnsAllSupportedFullFiscalYearLedger = {
      ...staged,
      revision: staged.revision + 1,
      status: "blocked",
      updatedAt: intentAt.toISOString(),
      zipPhase: "download-intent-persisted",
      zipDownloadAttempt: { requestedAt: intentAt.toISOString() },
    };
    delete ledger.currentTargetId;
    await persistAllSupportedFullFiscalYearLedger({ storageKeys: STORAGE_KEYS }, ledger);
    return ledger;
  }

  function planCardControls(): string[] {
    const card = container.querySelector<HTMLElement>(
      'section[aria-label="All supported returns progress"]',
    );
    expect(card, "the all-returns plan card renders").not.toBeNull();
    return [...card!.querySelectorAll("button")].map((button) => button.textContent ?? "");
  }

  it("has an accepted way out: the Options page clears the saved plan", async () => {
    const ledger = await seedIntentPlan();
    await startWorker();
    await mountPanel();
    expect(panelText()).toContain("All supported returns · FY");
    // Worker start does not move this phase on: no ID exists to reconcile.
    expect((await readAllSupportedFullFiscalYearLedgerById(ledger.ledgerId))?.zipPhase).toBe(
      "download-intent-persisted",
    );

    const optionsStatus = await clearLocalDataFromOptions();
    expect(optionsStatus).toContain("Pack local and session storage keys cleared.");
    expect(await readAllSupportedFullFiscalYearLedgerById(ledger.ledgerId)).toBeNull();

    await returnToPanel();
    expect(panelText()).not.toContain("All supported returns · FY");
    expect(panelText()).toContain("What do you need?");
  });

  it("tells the reader where that way out is when the plan card offers no control", async () => {
    await seedIntentPlan();
    await startWorker();
    await mountPanel();
    if (planCardControls().length > 0) return;

    // No control on the card. #380's precedent: the message is then the only way out, so it must
    // name the Options action -- not send the reader to a discard the card does not render.
    expect(panelText(), `Panel offers no plan control and says: ${panelText()}`).toContain(
      PACK_CLEAR_LOCAL_DATA_ACTION_LABEL,
    );
    expect(panelText()).not.toContain("from its run summary");
  });

  it("pins what the panel offers today: no plan control, and a resume would not move it", async () => {
    const ledger = await seedIntentPlan();
    await startWorker();
    await mountPanel();
    expect(planCardControls()).toEqual([]);

    // The start the card's "Resume this plan" would send, were it offered, returns the final-ZIP
    // review step and leaves the phase where it was.
    const response = await sendAsReader({
      type: "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW",
      payload: ledger.planRoot,
    });
    expect(response).toMatchObject({
      ok: true,
      allSupportedFullFiscalYearFlowSummary: {
        flowStep: {
          safeSignals: expect.arrayContaining([
            "all-supported-full-fiscal-year-final-zip-manual-review",
          ]),
          // An action's answer names the same exit as the polled summary: one step, not two.
          safeMessage: expect.stringContaining(PACK_CLEAR_LOCAL_DATA_ACTION_LABEL),
        },
      },
    });
    expect((await readAllSupportedFullFiscalYearLedgerById(ledger.ledgerId))?.zipPhase).toBe(
      "download-intent-persisted",
    );
  });
});

function stagedAllSupportedStep(
  target: FiledReturnsAllSupportedFullFiscalYearTarget,
): PortalFlowStepResult {
  const diagnostics: FiledReturnsDownloadDiagnostic[] = target.concreteArtifactTypes.map(
    (artifactType) => ({
      actionId: `action-12345678-${artifactType.toLowerCase()}`,
      artifactType,
      byteCountClass: "non-empty" as const,
      downloadPathClass: "captured-portal-request-data" as const,
      endpointClass:
        target.returnType === "GSTR-1"
          ? artifactType === "EXCEL"
            ? "gstr1-excel-portal-blob-captured-download"
            : "gstr1-pdf-portal-blob-captured-download"
          : target.returnType === "GSTR-3B"
            ? artifactType === "JSON"
              ? "gstr3b-main-world-json-captured-download"
              : "gstr3b-portal-blob-captured-download"
            : artifactType === "JSON"
              ? "gstr2b-main-world-json-captured-download"
              : "gstr2b-portal-blob-captured-download",
      eventType: "filed-return-download-path" as const,
      financialYear: target.financialYear,
      mimeClass:
        artifactType === "PDF"
          ? ("pdf" as const)
          : artifactType === "JSON"
            ? ("json" as const)
            : ("spreadsheet" as const),
      period: target.period,
      returnType: target.returnType,
      schemaVersion: "1.0" as const,
      status: "downloaded" as const,
    }),
  );
  return {
    connectorId: "gst" as const,
    downloadDiagnostic: diagnostics[diagnostics.length - 1]!,
    downloadDiagnostics: diagnostics,
    safeMessage: "Pack staged the target-bound artifact.",
    safeSignals: [
      ...target.concreteArtifactTypes.map(
        (artifactType) => `filed-return-artifact-downloaded:${artifactType}`,
      ),
      "all-supported-full-fiscal-year-opfs-staged",
      ...target.concreteArtifactTypes.map(
        (artifactType) => `all-supported-full-fiscal-year-opfs-staged:${artifactType}`,
      ),
    ],
    scopeId: "gst-filed-returns-private-v0",
    state: "downloaded" as const,
  };
}

/**
 * D4. A single-return full-year period stopped because the GST Portal tab pinned to the saved plan
 * is gone, in the same browser session. The message tells the reader to use Cancel and reset.
 * Suspicion: the panel still offers "Retry {period}", the background accepts it without looking at
 * the signal, the flow re-requires the same pinned tab, and the reader lands back on the identical
 * blocked period with the identical retry -- the single-return sibling of #376.
 */
describe("D4: retrying a single-return period whose pinned GST tab is gone", () => {
  const PINNED_TAB_SIGNAL = "full-fiscal-year-pinned-gst-tab-unavailable";
  const TAB_SESSION = "synthetic-tab-session-0001";

  async function seedPinnedTabLost() {
    const stoppedAt = new Date(Date.now() - STALE_BY_MS);
    const scope = singleReturnScope();
    const created = createFullFiscalYearLedger(
      scope,
      stoppedAt,
      getFiledReturnsFullFiscalYearPeriods(scope.financialYear, new Date(), scope.returnType),
    );
    const targetId = created.targets[0]!.targetId;
    const running = markFullFiscalYearTargetRunning(created, targetId, stoppedAt);
    const blocked = markFullFiscalYearTargetTerminal(
      running,
      targetId,
      "blocked",
      {
        connectorId: "gst",
        scopeId: filedReturnsScopeId(scope.returnType),
        state: "blocked",
        safeSignals: [PINNED_TAB_SIGNAL],
        safeMessage: canonicalDurableSummaryMessage(scope, "blocked", [PINNED_TAB_SIGNAL]),
      },
      stoppedAt,
    );
    const ledger: FiledReturnsFullFiscalYearLedger = {
      ...blocked,
      status: "blocked",
      portalTabId: 4242,
      portalTabSessionId: TAB_SESSION,
    };
    await persistLedger({ storageKeys: STORAGE_KEYS }, ledger);
    // Same browser session: the tab-session marker still matches the saved plan's.
    env.state.session["pack:full-fiscal-year-tab-session"] = TAB_SESSION;
    return { ledger, period: ledger.targets[0]!.period };
  }

  it("does not offer a retry that returns the reader to the same blocked period", async () => {
    const { ledger, period } = await seedPinnedTabLost();
    await startWorker();
    await mountPanel();
    await openRecoveryOptions();
    expect(panelText()).toContain(
      "GST Portal tab selected for this saved plan is no longer available",
    );

    const retryLabel = new RegExp(`^Retry ${period}$`);
    const retry = findButton(retryLabel);
    if (retry) {
      await click(retry);
      await openRecoveryOptions();
      const stored = await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId);
      const backWhereItStarted =
        stored?.targets[0]?.status === "blocked" &&
        stored.targets[0].safeSignals.includes(PINNED_TAB_SIGNAL);
      expect(
        backWhereItStarted && findButton(retryLabel) !== undefined,
        `after "Retry ${period}" the reader is back on the same blocked period, offered the same retry: ${JSON.stringify(buttonLabels())}`,
      ).toBe(false);
    }

    // The way out the message names must be there and accepted.
    const leave = findButton(/^Cancel and reset$/);
    expect(leave, `no way out among: ${JSON.stringify(buttonLabels())}`).toBeDefined();
    await click(leave!);
    expect(await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId)).toBeNull();
  });

  it("refuses a retry sent for that period without re-running the flow", async () => {
    const { ledger } = await seedPinnedTabLost();
    await startWorker();
    const response = await sendAsReader({
      type: "PACK_RETRY_FULL_FISCAL_YEAR_TARGET",
      payload: {
        ledgerId: ledger.ledgerId,
        targetId: ledger.targets[0]!.targetId,
        expectedRevision: ledger.revision ?? 1,
      },
    });

    // The saved run is answered as it stands: its own message names the exit.
    expect(response).toMatchObject({
      ok: true,
      flowSummary: { status: "blocked" },
      flowStep: { safeSignals: expect.arrayContaining([PINNED_TAB_SIGNAL]) },
    });
    const stored = await readLedgerById({ storageKeys: STORAGE_KEYS }, ledger.ledgerId);
    expect(stored?.revision).toBe(ledger.revision);
    expect(stored?.targets[0]?.status).toBe("blocked");
  });
});

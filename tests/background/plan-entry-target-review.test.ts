import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ActiveRunModule from "../../src/background/filed-returns-active-run";
import type * as FullFiscalYearModule from "../../src/background/filed-returns-full-fiscal-year";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
} from "../../src/connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";

// #402: `surfaceRetainedArtifactAcquisitionReview` runs at every plan entry and writes the
// target-review slot, which `readCurrentFiledReturnsFlowSummary` returns ahead of everything
// else. If a plan's own child left a retained acquisition checkpoint behind, the next Start
// would replace the completed plan card with a review for a target the plan already has --
// the #387 shape. These tests run a real staged child acquisition, then the real plan-entry
// scan, then the real panel reader, and compare with the same child run as a direct download.

const storage = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
}));
const mocks = vi.hoisted(() => {
  const area = (name: "local" | "session") => ({
    get: vi.fn(async (key?: string | string[] | null) => {
      if (key == null) return structuredClone(storage[name]);
      return Object.fromEntries(
        (Array.isArray(key) ? key : [key]).map((entry) => [
          entry,
          structuredClone(storage[name][entry]),
        ]),
      );
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(storage[name], structuredClone(values));
    }),
    remove: vi.fn(async (key: string | string[]) => {
      for (const entry of Array.isArray(key) ? key : [key]) delete storage[name][entry];
    }),
  });
  return {
    local: area("local"),
    session: area("session"),
    downloadsSearch: vi.fn(),
    acquireGstr3bPdfAfterPreflight: vi.fn(),
    acquireFiledReturnJsonInMainWorld: vi.fn(),
    downloadAcquiredArtifact: vi.fn(),
    stageOffscreenFiledReturn: vi.fn(),
    startFullFiscalYearDownloadFlow: vi.fn(),
    actualStartFullFiscalYearDownloadFlow: null as
      null | (typeof FullFiscalYearModule)["startFullFiscalYearDownloadFlow"],
  };
});

vi.mock("wxt/browser", () => ({
  browser: {
    storage: { local: mocks.local, session: mocks.session },
    downloads: { search: mocks.downloadsSearch },
  },
}));
vi.mock("../../src/background/artifact-download", () => ({
  downloadAcquiredArtifact: mocks.downloadAcquiredArtifact,
}));
vi.mock("../../src/background/gstr3b-artifact-acquisition", () => ({
  acquireGstr3bPdfAfterPreflight: mocks.acquireGstr3bPdfAfterPreflight,
}));
vi.mock("../../src/background/filed-returns-json-acquisition", () => ({
  acquireFiledReturnJsonInMainWorld: mocks.acquireFiledReturnJsonInMainWorld,
}));
vi.mock("../../src/background/offscreen-blob-url", () => ({
  stageOffscreenFiledReturn: mocks.stageOffscreenFiledReturn,
}));
// The lease is a concurrency guard with its own tests; a renewal timer here would only leak.
vi.mock("../../src/background/filed-returns-active-run", async (importOriginal) => ({
  ...(await importOriginal<typeof ActiveRunModule>()),
  acquireFiledReturnsRun: vi.fn(async () => ({ run: { id: "synthetic-run" } })),
  releaseFiledReturnsRun: vi.fn(async () => undefined),
  startFiledReturnsRunLeaseRenewal: vi.fn(() => () => undefined),
}));
// Past the plan-entry scan the Start would drive the portal. It is replaced by a no-op so the
// only storage write under test is the scan's own.
vi.mock("../../src/background/filed-returns-full-fiscal-year", async (importOriginal) => {
  const actual = await importOriginal<typeof FullFiscalYearModule>();
  mocks.actualStartFullFiscalYearDownloadFlow = actual.startFullFiscalYearDownloadFlow;
  return { ...actual, startFullFiscalYearDownloadFlow: mocks.startFullFiscalYearDownloadFlow };
});

import { triggerAndObserveFiledReturnDownload } from "../../src/background/filed-returns-download-trigger";
import {
  retryFullFiscalYearTargetDownloadFlow,
  startFiledReturnsDownloadFlow,
} from "../../src/background/filed-returns-flow-runner";
import { readCurrentFiledReturnsFlowSummary } from "../../src/background/filed-returns-current-state";
import { createFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import {
  persistLedger,
  readLedgerForScope,
} from "../../src/background/filed-returns-full-fiscal-year-run-state";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { persistCanonicalFiledReturnsFlowSummary } from "../../src/background/filed-returns-session-summary";

const NOW = new Date("2026-08-25T00:00:00.000Z");
const storageKeys = {
  activeRun: "active",
  completion: "completion",
  fullFiscalYearLedger: "legacy",
  fullFiscalYearLedgerIndex: "index",
  observation: "observation",
  targetReview: "review",
};
const deps = {
  getActiveGstTab: async () => null,
  now: () => NOW,
  sendMessageToTabWithInjection: vi.fn(async () => readyArtifact()),
  storageKeys,
};

// One case per checkpoint-writing acquisition path in the download trigger.
const CHILD_TARGETS = [
  { artifactType: "JSON", returnType: "GSTR-3B" },
  { artifactType: "PDF", returnType: "GSTR-3B" },
  { artifactType: "JSON", returnType: "GSTR-2B" },
] as const;
type ChildTarget = (typeof CHILD_TARGETS)[number];

function planScope(target: ChildTarget): FiledReturnsDownloadScope {
  return { ...target, financialYear: "2025-26", period: FULL_FISCAL_YEAR_PERIOD };
}

async function installCompletedPlan(target: ChildTarget) {
  const created = createFullFiscalYearLedger(planScope(target), NOW, ["April", "May"]);
  const ledger: FiledReturnsFullFiscalYearLedger = {
    ...created,
    status: "complete",
    zipPhase: "cleaned-without-export",
    targets: created.targets.map((target) => ({
      ...target,
      status: "not-filed",
      ...canonicalDurableTargetStatus(target, "not-filed", ["filed-return-positively-not-filed"]),
    })),
  };
  await persistLedger(deps, ledger);
  await persistCanonicalFiledReturnsFlowSummary(
    storageKeys.completion,
    summariseFullFiscalYearLedger(ledger, NOW),
  );
}

// A plan child hands the captured bytes to `deliver`, as the real acquisitions do, and staging
// succeeds: every child of a completed plan got here. A direct child starts a browser download
// whose outcome Pack never learns -- the case a direct run must retain for review.
function stageOrStartDownloadThenTimeOut() {
  const acquire = async (input: {
    deliver?: (input: { base64: string; mimeType: string }) => Promise<unknown>;
    onStarted?: (downloadId: number) => Promise<void>;
  }) => {
    if (input.deliver) return input.deliver({ base64: "e30=", mimeType: "application/json" });
    await input.onStarted?.(91);
    return { ok: false as const, reason: "timeout", safeSignals: [] };
  };
  mocks.acquireGstr3bPdfAfterPreflight.mockImplementation(acquire);
  mocks.acquireFiledReturnJsonInMainWorld.mockImplementation(acquire);
  // A direct `deliver` reaches the browser download with the checkpoint callbacks attached.
  mocks.downloadAcquiredArtifact.mockImplementation(acquire);
  mocks.stageOffscreenFiledReturn.mockResolvedValue({ status: "staged" });
}

async function runChild(
  target: ChildTarget,
  stageCapturedDownloads?: { bundleKind: "full-fiscal-year"; ledgerId: string },
  period = "May",
) {
  return triggerAndObserveFiledReturnDownload({
    activePeriod: period,
    artifactType: target.artifactType,
    deps: {
      sendMessageToTabWithInjection: vi.fn(async () => readyArtifact()),
      // A plan child inherits the plan's own keys (`{ ...deps, stageCapturedDownloads }`).
      storageKeys,
      ...(stageCapturedDownloads ? { stageCapturedDownloads } : {}),
    },
    scope: { ...target, financialYear: "2025-26", period },
    tabId: 17,
  });
}

describe("plan-entry target review after a completed plan (#402)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.local = {};
    storage.session = {};
    stageOrStartDownloadThenTimeOut();
    mocks.downloadsSearch.mockResolvedValue([{ id: 91, state: "in_progress" }]);
    mocks.startFullFiscalYearDownloadFlow.mockResolvedValue({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-private-v0",
        state: "clicked",
        safeSignals: ["synthetic-plan-start"],
        safeMessage: "Synthetic plan start.",
      },
    });
  });

  it.each(CHILD_TARGETS)(
    "keeps the completed plan card after its $returnType $artifactType child staged its artifact",
    async (target) => {
      await installCompletedPlan(target);
      await expect(readCurrentFiledReturnsFlowSummary(deps)).resolves.toMatchObject({
        scope: planScope(target),
        status: "complete",
      });

      await expect(
        runChild(target, { bundleKind: "full-fiscal-year", ledgerId: "synthetic-plan" }),
      ).resolves.toMatchObject({ flowStep: { state: "downloaded" } });
      await startFiledReturnsDownloadFlow(planScope(target), deps as never);

      expect(storage.local[storageKeys.targetReview]).toBeUndefined();
      expect(mocks.startFullFiscalYearDownloadFlow).toHaveBeenCalledOnce();
      await expect(readCurrentFiledReturnsFlowSummary(deps)).resolves.toMatchObject({
        scope: planScope(target),
        status: "complete",
      });
    },
  );

  // The control: the same child run as a direct download retains its checkpoint, and the scan
  // then puts a review in front of the plan. That review is correct -- the browser holds a
  // download Pack cannot account for -- and it shows the scan and reader are really exercised.
  it.each(CHILD_TARGETS)(
    "surfaces a review over the plan when a direct $returnType $artifactType download is unaccounted for",
    async (target) => {
      await installCompletedPlan(target);

      await runChild(target);
      await startFiledReturnsDownloadFlow(planScope(target), deps as never);

      expect(storage.local[storageKeys.targetReview]).toBeDefined();
      expect(mocks.startFullFiscalYearDownloadFlow).not.toHaveBeenCalled();
      await expect(readCurrentFiledReturnsFlowSummary(deps)).resolves.toMatchObject({
        scope: { ...target, period: "May" },
        status: "blocked",
      });
    },
  );
});

function readyArtifact(): PackMessageResponse {
  return {
    ok: true,
    artifact: {
      ok: true,
      state: "ready",
      requestId: "synthetic-request",
      safeSignals: [],
    },
  };
}

// Review finding on this change: the full-year single-target Retry does not run the plan-entry scan,
// so a direct run's checkpoint for the retried target is found by the plan child instead, and the
// child writes the review. The review is correct -- the browser holds a download Pack cannot account
// for -- so what matters is that the plan stops on it and never completes over it.
describe("a plan child that finds a direct run's checkpoint (#402 review)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.local = {};
    storage.session = {};
    stageOrStartDownloadThenTimeOut();
    mocks.downloadsSearch.mockResolvedValue([{ id: 91, state: "in_progress" }]);
    mocks.startFullFiscalYearDownloadFlow.mockImplementation(
      mocks.actualStartFullFiscalYearDownloadFlow!,
    );
  });

  it("stops the plan at the reviewed month instead of completing over the review", async () => {
    const target = CHILD_TARGETS[0];
    const created = createFullFiscalYearLedger(planScope(target), NOW, ["April", "May"]);
    await persistLedger(deps, created);
    const april = created.targets.find((planTarget) => planTarget.period === "April")!;
    await runChild(target, undefined, "April");
    const ledgerBefore = await readLedgerForScope(deps, planScope(target));

    await retryFullFiscalYearTargetDownloadFlow(
      {
        expectedRevision: ledgerBefore!.revision ?? 1,
        ledgerId: created.ledgerId,
        targetId: april.targetId,
      },
      deps as never,
    );

    const ledgerAfter = await readLedgerForScope(deps, planScope(target));
    expect(ledgerAfter?.status).not.toBe("complete");
    expect(ledgerAfter?.targets.find((planTarget) => planTarget.period === "May")?.status).toBe(
      "pending",
    );
    expect(storage.local[storageKeys.targetReview]).toBeDefined();
    await expect(readCurrentFiledReturnsFlowSummary(deps)).resolves.toMatchObject({
      scope: { ...target, period: "April" },
      status: "blocked",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import type { FiledReturnsSummaryStatus } from "../../src/connectors/gst/filed-returns-summary-status";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-validation";
import { filedReturnsScopeId } from "../../src/connectors/gst/filed-returns-return-types";
import {
  FULL_FISCAL_YEAR_PERIOD,
  getFiledReturnsFullFiscalYearPeriods,
} from "../../src/connectors/gst/filed-returns-scope";

const storage = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
}));
const zip = vi.hoisted(() => ({
  exportFullFiscalYearZip: vi.fn(),
  reconcileFullFiscalYearZipDownload: vi.fn(),
  discardFullFiscalYearFiledReturnsZip: vi.fn(),
}));

vi.mock("wxt/browser", () => {
  const area = (name: keyof typeof storage) => ({
    get: vi.fn(async (key?: unknown) =>
      structuredClone(typeof key === "string" ? { [key]: storage[name][key] } : storage[name]),
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(storage[name], structuredClone(values));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[name][key];
    }),
  });
  return { browser: { storage: { local: area("local"), session: area("session") } } };
});
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => zip);

const requestedAt = new Date("2017-08-20T00:00:00.000Z");
const observedAt = new Date("2017-08-20T00:01:00.000Z");
const scope: FiledReturnsDownloadScope = {
  artifactType: "PDF",
  financialYear: "2017-18",
  period: FULL_FISCAL_YEAR_PERIOD,
  returnType: "GSTR-3B",
};
const outcomeSignals = [
  "full-fiscal-year-summary-included",
  "full-fiscal-year-summary-parsed-period-count:1",
  "full-fiscal-year-summary-row-count:4",
];
let clock = requestedAt;

describe("initial observing full-year summary checkpoint", () => {
  beforeEach(() => {
    storage.local = {};
    storage.session = {};
    clock = requestedAt;
    vi.resetAllMocks();
    vi.resetModules();
    zip.discardFullFiscalYearFiledReturnsZip.mockResolvedValue(["full-fiscal-year-opfs-cleared"]);
  });

  it("persists the initial observation's summary outcome after completion and worker restart", async () => {
    await persistInitialObservation();

    await restartAndReconcileCompletedDownload();

    expect(storedSummary()).toMatchObject({
      status: "complete",
      flowStep: {
        safeSignals: expect.arrayContaining(outcomeSignals),
        safeMessage: expect.stringContaining("workbook and tidy CSV for 1 period"),
      },
    });
    expect(storedLedger().zipPhase).toBe("cleaned-after-download");
  });

  it.each([
    {
      name: "stale summary timestamp",
      change: (summary: FiledReturnsFlowSummary) => ({
        ...summary,
        updatedAt: requestedAt.toISOString(),
      }),
    },
    {
      name: "different financial-year scope",
      change: (summary: FiledReturnsFlowSummary) => ({
        ...summary,
        scope: { ...summary.scope, financialYear: "2018-19" },
      }),
    },
    {
      name: "non-observing summary phase",
      change: (summary: FiledReturnsFlowSummary) => ({
        ...summary,
        flowStep: {
          ...summary.flowStep,
          safeSignals: summary.flowStep.safeSignals.map((signal) =>
            signal === "full-fiscal-year-zip-phase:download-observing"
              ? "full-fiscal-year-zip-phase:export-retry-pending"
              : signal,
          ),
        },
      }),
    },
  ])("does not restore an outcome from a $name", async ({ change }) => {
    await persistInitialObservation();
    storage.session.completion = change(storedSummary());
    // Rejection must be the checkpoint binding, not a malformed fixture.
    expect(parseDurableFiledReturnsFlowSummary(storage.session.completion)).not.toBeNull();

    await restartAndReconcileCompletedDownload();

    for (const signal of outcomeSignals) {
      expect(storedSummary().flowStep.safeSignals).not.toContain(signal);
    }
    expect(storedSummary().status).toBe("complete");
  });
});

async function persistInitialObservation(): Promise<void> {
  const { startFullFiscalYearDownloadFlow } =
    await import("../../src/background/filed-returns-full-fiscal-year");
  zip.exportFullFiscalYearZip.mockImplementationOnce(
    async (
      _ledger: unknown,
      _step: unknown,
      callbacks: {
        onBeforeDownloadStart: (at: Date, outcome: FiledReturnsSummaryStatus) => Promise<void>;
        onDownloadStarted: (downloadId: number) => Promise<void>;
      },
    ) => {
      await callbacks.onBeforeDownloadStart(requestedAt, { safeSignals: outcomeSignals });
      clock = observedAt;
      await callbacks.onDownloadStarted(41);
      return zipStep("download-unconfirmed", [
        ...outcomeSignals,
        "full-fiscal-year-zip-download-unconfirmed",
        "browser-download-in-progress",
      ]);
    },
  );
  const runSinglePeriod = vi.fn(async (targetScope: FiledReturnsDownloadScope) => ({
    ok: true as const,
    flowStep: stagedPeriodStep(targetScope),
  }));

  await startFullFiscalYearDownloadFlow(scope, deps(), runSinglePeriod);

  expect(runSinglePeriod).toHaveBeenCalledTimes(
    getFiledReturnsFullFiscalYearPeriods(scope.financialYear, requestedAt).length,
  );
  expect(storedLedger()).toMatchObject({
    zipPhase: "download-observing",
    updatedAt: observedAt.toISOString(),
    zipDownloadAttempt: { downloadId: 41, requestedAt: requestedAt.toISOString() },
  });
  const summary = storedSummary();
  expect(summary.updatedAt).toBe(observedAt.toISOString());
  expect(summary.flowStep.safeSignals).toEqual(
    expect.arrayContaining([...outcomeSignals, "full-fiscal-year-zip-phase:download-observing"]),
  );
  expect(summary.flowStep.safeSignals).not.toContain("full-fiscal-year-zip-reconciled-by-id");
}

async function restartAndReconcileCompletedDownload(): Promise<void> {
  // The download finishes while the worker is absent; only the two storage areas survive.
  vi.resetModules();
  clock = new Date("2017-08-20T00:02:00.000Z");
  zip.reconcileFullFiscalYearZipDownload.mockResolvedValueOnce(
    zipStep("downloaded", [
      "full-fiscal-year-zip-reconciled-by-id",
      "full-fiscal-year-zip-downloaded",
      "browser-download-completed",
      "browser-download-non-empty",
    ]),
  );
  const { reconcilePersistedFullFiscalYearZipDownload } =
    await import("../../src/background/filed-returns-full-fiscal-year");

  await expect(reconcilePersistedFullFiscalYearZipDownload(deps())).resolves.toBe(true);

  expect(zip.reconcileFullFiscalYearZipDownload).toHaveBeenCalledWith(
    expect.objectContaining({
      ledgerId: storedLedger().ledgerId,
      scope,
      zipDownloadAttempt: { downloadId: 41, requestedAt: requestedAt.toISOString() },
    }),
    expect.anything(),
  );
  expect(zip.exportFullFiscalYearZip).toHaveBeenCalledOnce();
}

function deps(): FiledReturnsFlowRunnerDeps {
  return {
    getActiveGstTab: async () => null,
    sendMessageToTabWithInjection: async () => {
      throw new Error("Unexpected portal interaction in synthetic restart recovery");
    },
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "full-year-ledger",
      observation: "observation",
      targetReview: "target-review",
    },
    now: () => clock,
  };
}

function storedSummary(): FiledReturnsFlowSummary {
  const summary = parseDurableFiledReturnsFlowSummary(storage.session.completion);
  expect(summary).not.toBeNull();
  if (!summary) throw new Error("Expected a valid persisted summary");
  return summary;
}

function storedLedger() {
  const ledger = storage.local["full-year-ledger"];
  expect(isFullFiscalYearLedger(ledger)).toBe(true);
  if (!isFullFiscalYearLedger(ledger)) throw new Error("Expected a valid persisted ledger");
  return ledger;
}

function zipStep(state: PortalFlowStepResult["state"], signals: string[]): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnsScopeId(scope.returnType),
    state,
    safeSignals: [
      "full-fiscal-year-zip-download-started",
      "full-fiscal-year-opfs-retained",
      ...signals,
    ],
    safeMessage: "Synthetic exact ZIP observation.",
  };
}

function stagedPeriodStep(target: FiledReturnsDownloadScope): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnsScopeId(target.returnType),
    state: "downloaded",
    safeSignals: ["filed-return-artifact-downloaded:PDF", "full-fiscal-year-opfs-staged:PDF"],
    safeMessage: "Synthetic PDF staged.",
    downloadDiagnostic: {
      actionId: "00000000-0000-4000-8000-000000000001",
      artifactType: "PDF",
      byteCountClass: "non-empty",
      downloadPathClass: "captured-portal-request-data",
      endpointClass: "gstr3b-portal-blob-captured-download",
      eventType: "filed-return-download-path",
      financialYear: target.financialYear,
      mimeClass: "pdf",
      period: target.period,
      returnType: target.returnType,
      schemaVersion: "1.0",
      status: "downloaded",
    },
  };
}

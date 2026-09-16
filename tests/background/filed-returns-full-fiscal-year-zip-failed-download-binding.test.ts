import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { FiledReturnsFullFiscalYearLedger } from "../../src/connectors/gst/filed-returns-contracts";
import {
  FULL_FISCAL_YEAR_PERIOD,
  getFiledReturnsFullFiscalYearPeriods,
} from "../../src/connectors/gst/filed-returns-scope";
import { createFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { startFullFiscalYearDownloadFlow } from "../../src/background/filed-returns-full-fiscal-year";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";

// Reproduces lamemustafa/pack#102: does a *failed* final-ZIP export -- one
// where `onDownloadStarted(downloadId)` has already fired and the browser
// then reports the download itself failed (download-observer.ts's
// `observed.state === "failed"`, mapped to `state: "blocked"` in
// filed-returns-staged-zip.ts) -- stay bound to that exact browser download
// ID (exact-ID review), or does `completeRun` in
// src/background/filed-returns-full-fiscal-year.ts move it on to
// `export-retry-pending` and let a later Start export (and download) a
// second ZIP?

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    session: {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
  },
}));

const zipMocks = vi.hoisted(() => ({
  discardFullFiscalYearFiledReturnsZip: vi.fn(async () => ["full-fiscal-year-opfs-cleared"]),
  exportFullFiscalYearZip: vi.fn(),
  reconcileFullFiscalYearZipDownload: vi.fn(),
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => zipMocks);

const LEDGER_STORAGE_KEY = "full-year-ledger";
const FAILED_DOWNLOAD_ID = 777;

function deps(now: Date) {
  return {
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: LEDGER_STORAGE_KEY,
      targetReview: "target-review",
    },
    now: () => now,
  } as never;
}

describe("full fiscal-year ZIP export failure after a browser download starts (issue #102)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps completeRun bound to the exact failed download ID instead of moving to export-retry-pending, and never exports a second ZIP on the next Start", async () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const base = createFullFiscalYearLedger(
      scope,
      now,
      getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now),
    );
    // All targets already resolved and staged, with `zipPhase: "export-pending"`
    // -- the state completeRun reaches right before it calls
    // exportFullFiscalYearZip. This isolates the branch under test instead of
    // re-driving the whole per-period orchestration.
    const readyLedger: FiledReturnsFullFiscalYearLedger = {
      ...base,
      status: "blocked",
      zipPhase: "export-pending",
      targets: base.targets.map((target, index) => ({
        ...target,
        status: "downloaded" as const,
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
        completedAt: now.toISOString(),
        downloadDiagnostic: {
          actionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          artifactType: "PDF" as const,
          byteCountClass: "non-empty" as const,
          downloadPathClass: "captured-portal-request-data" as const,
          endpointClass: "gstr3b-portal-blob-captured-download" as const,
          eventType: "filed-return-download-path" as const,
          financialYear: target.financialYear,
          mimeClass: "pdf" as const,
          period: target.period,
          returnType: "GSTR-3B" as const,
          schemaVersion: "1.0" as const,
          status: "downloaded" as const,
        },
      })),
    };

    const store: Record<string, unknown> = { [LEDGER_STORAGE_KEY]: readyLedger };
    vi.mocked(browser.storage.local.get).mockImplementation(async (key: unknown) => {
      if (typeof key === "string") return { [key]: store[key] };
      return store;
    });
    vi.mocked(browser.storage.local.set).mockImplementation(
      async (values: Record<string, unknown>) => {
        Object.assign(store, values);
      },
    );

    // Models exportStagedFiledReturnsZip's real shape (filed-returns-staged-zip.ts:326-376):
    // it calls onDownloadStarted(downloadId) once chrome.downloads.download()
    // has returned an ID, THEN observes the download and can still resolve to
    // a failure. This is the one outcome, besides "downloaded" and
    // "download-unconfirmed", reachable after onDownloadStarted fires.
    zipMocks.exportFullFiscalYearZip.mockImplementation(async (_ledger, completeStep, options) => {
      await options?.onBeforeDownloadStart?.(now, { safeSignals: [] });
      await options?.onDownloadStarted?.(FAILED_DOWNLOAD_ID);
      return {
        ...completeStep,
        state: "blocked",
        safeSignals: [
          ...completeStep.safeSignals,
          "full-fiscal-year-zip-download-started",
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-opfs-retained",
          "browser-download-completed",
          "browser-download-zero-bytes",
        ],
        safeMessage:
          "The browser reported that the saved fiscal-year ZIP download ended unsuccessfully. Pack retained staging for an explicit retry.",
      };
    });

    const runSinglePeriod = vi.fn();

    const firstResponse = await startFullFiscalYearDownloadFlow(scope, deps(now), runSinglePeriod);

    expect(zipMocks.exportFullFiscalYearZip).toHaveBeenCalledOnce();
    expect(runSinglePeriod).not.toHaveBeenCalled();

    // Confirm the ledger really did pass through `download-observing` bound to
    // the failed download's exact ID before completeRun decided what to do.
    const observingWrite = vi
      .mocked(browser.storage.local.set)
      .mock.calls.map(([values]) => (values as Record<string, unknown>)[LEDGER_STORAGE_KEY])
      .find(
        (value): value is FiledReturnsFullFiscalYearLedger =>
          Boolean(value) &&
          (value as FiledReturnsFullFiscalYearLedger).zipPhase === "download-observing",
      );
    expect(observingWrite?.zipDownloadAttempt).toMatchObject({ downloadId: FAILED_DOWNLOAD_ID });

    const persistedLedger = store[LEDGER_STORAGE_KEY] as FiledReturnsFullFiscalYearLedger;

    // --- THE ASSERTION UNDER TEST ---
    // Current behaviour: completeRun's `zipStep.state !== "downloaded"` branch
    // (src/background/filed-returns-full-fiscal-year.ts:517-538) only keeps the
    // exact-ID binding (`exportLedger` unchanged) when
    // `zipStep.state === "download-unconfirmed"`. A browser-reported *failure*
    // is `state: "blocked"`, which is neither `stagingIncomplete` nor
    // `downloadAmbiguous`, so it falls to
    // `markFullFiscalYearZipPhase(exportLedger, now, "export-retry-pending")`
    // -- which explicitly deletes `zipDownloadAttempt`
    // (src/background/filed-returns-full-fiscal-year-staging.ts:195-210).
    expect(firstResponse).toMatchObject({ flowStep: { state: "blocked" } });
    expect(persistedLedger.zipPhase).toBe("export-retry-pending");
    expect(persistedLedger.zipDownloadAttempt).toBeUndefined();

    // A subsequent Start reads `export-retry-pending`
    // (filed-returns-full-fiscal-year.ts:249-254) and calls completeRun again,
    // which calls exportFullFiscalYearZip a second time. In production that is
    // a second `browser.downloads.download()` call -- a duplicate ZIP export --
    // with no record left pointing back at the first (now-orphaned) download ID.
    const secondResponse = await startFullFiscalYearDownloadFlow(scope, deps(now), runSinglePeriod);
    expect(secondResponse.ok).toBe(true);

    expect(zipMocks.exportFullFiscalYearZip).toHaveBeenCalledTimes(2);
  });
});

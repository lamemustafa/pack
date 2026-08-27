import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
} from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { getFiledReturnsFullFiscalYearPeriods } from "../../src/connectors/gst/filed-returns-scope";
import { createFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import {
  FULL_FISCAL_YEAR_PLAN_VERSION,
  isFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-validation";
import {
  reconcilePendingFullFiscalYearZipDownload,
  reconcilePersistedFullFiscalYearZipDownload,
  startFullFiscalYearDownloadFlow,
} from "../../src/background/filed-returns-full-fiscal-year";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import {
  discardMalformedFullFiscalYearRunForFreshStart,
  prepareFullFiscalYearTargetRetry,
  resolveFullFiscalYearTarget,
} from "../../src/background/filed-returns-full-fiscal-year-recovery";
import { browser } from "wxt/browser";
import {
  canonicalDurableTargetStatus,
  isHistoricalDurableTargetMessage,
} from "../../src/connectors/gst/filed-returns-durable-status";
import {
  createFullFiscalYearCleanupPendingState,
  finishFullFiscalYearCleanup,
  markFullFiscalYearZipDownloadIntent,
  markFullFiscalYearZipDownloadObserving,
} from "../../src/background/filed-returns-full-fiscal-year-staging";
import {
  persistCanonicalFiledReturnsFlowSummary,
  readCanonicalFiledReturnsFlowSummary,
} from "../../src/background/filed-returns-session-summary";
import { parseDurableFiledReturnsSignals } from "../../src/connectors/gst/filed-returns-durable-signals";
import type { FiledReturnsSummaryStatus } from "../../src/connectors/gst/filed-returns-summary-status";
import { filedReturnsScopeId } from "../../src/connectors/gst/filed-returns-return-types";
import {
  fullFiscalYearZipPhaseStep,
  toFullFiscalYearSummary,
} from "../../src/background/filed-returns-full-fiscal-year-summary";
import { readLedger } from "../../src/background/filed-returns-full-fiscal-year-run-state";

const sessionValues = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    session: {
      get: vi.fn(async (key: string) => ({ [key]: sessionValues.current[key] })),
      remove: vi.fn(async (key: string) => {
        delete sessionValues.current[key];
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(sessionValues.current, values);
      }),
    },
  },
}));
const zipMocks = vi.hoisted(() => ({
  discardFullFiscalYearFiledReturnsZip: vi.fn(async () => ["full-fiscal-year-opfs-cleared"]),
  exportFullFiscalYearZip: vi.fn(),
  reconcileFullFiscalYearZipDownload: vi.fn(),
}));
const LEDGER_ID = "full-fiscal-year-12345678";

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => zipMocks);

describe("full fiscal-year recovery", () => {
  beforeEach(() => {
    sessionValues.current = {};
    vi.clearAllMocks();
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockResolvedValue([
      "full-fiscal-year-opfs-cleared",
    ]);
  });

  it("keeps an offscreen-response-invalid ZIP summary persisted for recovery", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };

    const summary = await persistCanonicalFiledReturnsFlowSummary("completion", {
      scope,
      status: "blocked",
      updatedAt: "2026-08-20T00:00:00.000Z",
      completedPeriods: [],
      totalPeriods: 12,
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnsScopeId(scope.returnType),
        state: "blocked",
        safeSignals: [
          "full-fiscal-year-zip-export-failed",
          "full-fiscal-year-zip-export-error:offscreen-response-invalid",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage: "Pack retained the staged fiscal-year files for a safe retry.",
      },
    });

    expect(summary?.flowStep.safeSignals).toContain(
      "full-fiscal-year-zip-export-error:offscreen-response-invalid",
    );
    expect(sessionValues.current.completion).toEqual(
      expect.objectContaining({
        flowStep: expect.objectContaining({
          safeSignals: expect.arrayContaining([
            "full-fiscal-year-zip-export-error:offscreen-response-invalid",
          ]),
        }),
      }),
    );
    expect(browser.storage.session.remove).not.toHaveBeenCalledWith("completion");
  });

  it("rejects stale target recovery revisions without mutating storage", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({ revision: 3 }),
    });

    const recovery = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(recovery).toMatchObject({
      ok: false,
      response: {
        ok: true,
        flowStep: {
          safeSignals: ["full-fiscal-year-recovery-stale"],
        },
      },
    });
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it("reads a historical blocked portal ledger and renders its canonical portal cause", async () => {
    const historicalLedger = createRecoveryLedger({
      revision: 2,
      targetStatus: "blocked",
      safeSignals: ["portal-system-error"],
    });
    historicalLedger.status = "blocked";
    historicalLedger.targets[0] = {
      ...historicalLedger.targets[0]!,
      safeMessage:
        "Pack could not verify the browser download for April. Check Downloads before retrying or cancelling this target.",
    };
    mockLocalStorageGet({ "full-year-ledger": historicalLedger });

    const ledger = await readLedger("full-year-ledger");

    expect(ledger).not.toBeNull();
    expect(summariseFullFiscalYearLedger(ledger!).flowStep.safeMessage).toBe(
      "The GST portal returned a system-error page. Return to an authenticated GST page and retry this period.",
    );
  });

  describe.each(["blocked", "partial", "running", "cancelled", "complete"] as const)(
    "historical filename recovery with %s aggregate status",
    (ledgerStatus) => {
      it.each([
        [
          "download-filename-overridden",
          "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
          "The browser may have used a different saved name, but Pack could not verify that any file belongs to this unresolved target. Check browser Downloads before using a file.",
        ],
        [
          "download-filename-unavailable",
          "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
          "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
        ],
        [
          "zip-download-filename-overridden",
          "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
          "The browser may have used a different saved name, but Pack could not verify that any file belongs to this unresolved target. Check browser Downloads before using a file.",
        ],
        [
          "zip-download-filename-unavailable",
          "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
          "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
        ],
        [
          "zip-download-filename-item-unavailable",
          "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
          "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
        ],
        [
          "zip-download-filename-search-unavailable",
          "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
          "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
        ],
      ])(
        "reads the exact historical unresolved filename cache for %s",
        async (signal, oldCopy, newCopy) => {
          const historicalLedger = createRecoveryLedger({
            revision: 2,
            targetStatus: "blocked",
            safeSignals: ["portal-system-error", signal],
          });
          historicalLedger.status = ledgerStatus;
          if (ledgerStatus === "complete") {
            historicalLedger.planVersion = FULL_FISCAL_YEAR_PLAN_VERSION;
            historicalLedger.eligibleThrough = "April";
          }
          const portalCause =
            "The GST portal returned a system-error page. Return to an authenticated GST page and retry this period.";
          historicalLedger.targets[0] = {
            ...historicalLedger.targets[0]!,
            safeMessage: `${portalCause} ${oldCopy}`,
          };
          mockLocalStorageGet({ "full-year-ledger": historicalLedger });

          const ledger = await readLedger("full-year-ledger");

          expect(ledger).not.toBeNull();
          expect(ledger).toMatchObject({
            ledgerId: LEDGER_ID,
            revision: 2,
            status: ledgerStatus,
            targets: [expect.objectContaining({ status: "blocked", attempts: 1 })],
          });
          const summary = summariseFullFiscalYearLedger(ledger!);
          expect(summary.flowStep.safeMessage).toBe(`${portalCause} ${newCopy}`);
          expect(summary.fullFiscalYearRecovery).toMatchObject({
            ledgerId: LEDGER_ID,
            targetId: "GSTR-3B:2026-27:April",
            targetStatus: "blocked",
          });
          const reopened = await readLedger("full-year-ledger");
          expect(reopened).toEqual(ledger);
          expect(summariseFullFiscalYearLedger(reopened!).flowStep.safeMessage).toBe(
            `${portalCause} ${newCopy}`,
          );
          if (ledgerStatus === "complete") {
            // Reconstruction preserves recovery; it does not relax the complete-summary guard.
            expect(summary.status).toBe("blocked");
            await expect(
              persistCanonicalFiledReturnsFlowSummary("rejected-completion", {
                ...summary,
                status: "complete",
              }),
            ).resolves.toBeNull();
          }
          const persisted = await persistCanonicalFiledReturnsFlowSummary("completion", summary);
          expect(persisted).not.toBeNull();
          const projectedStatus = ledgerStatus === "complete" ? "blocked" : ledgerStatus;
          const reopenedCause =
            projectedStatus === "blocked" || projectedStatus === "partial"
              ? portalCause
              : "Pack needs an explicit recovery action before continuing the saved fiscal-year run.";
          await expect(readCanonicalFiledReturnsFlowSummary("completion")).resolves.toMatchObject({
            status: projectedStatus,
            fullFiscalYearRecovery: { targetStatus: "blocked", expectedRevision: 2 },
            flowStep: { safeMessage: `${reopenedCause} ${newCopy}` },
          });
          expect(browser.storage.local.set).not.toHaveBeenCalled();
          expect(browser.storage.local.remove).not.toHaveBeenCalled();
          expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
          expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
        },
      );
    },
  );

  it.each<[string, (ledger: FiledReturnsFullFiscalYearLedger) => void]>([
    [
      "edited wording",
      (ledger) => {
        ledger.targets[0]!.safeMessage = ledger.targets[0]!.safeMessage.replace(
          "completed",
          "finished",
        );
      },
    ],
    [
      "prefixed wording",
      (ledger) => {
        ledger.targets[0]!.safeMessage = `Earlier: ${ledger.targets[0]!.safeMessage}`;
      },
    ],
    [
      "appended wording",
      (ledger) => {
        ledger.targets[0]!.safeMessage += " Extra instruction.";
      },
    ],
    [
      "extra whitespace",
      (ledger) => {
        ledger.targets[0]!.safeMessage += " ";
      },
    ],
    [
      "wrong period wording",
      (ledger) => {
        ledger.targets[0]!.safeMessage = ledger.targets[0]!.safeMessage.replace("April", "May");
      },
    ],
    [
      "wrong filename family",
      (ledger) => {
        ledger.targets[0]!.safeSignals = ["download-filename-unavailable"];
      },
    ],
    [
      "absent filename signal",
      (ledger) => {
        ledger.targets[0]!.safeSignals = [];
      },
    ],
    [
      "unknown signal",
      (ledger) => {
        ledger.targets[0]!.safeSignals.push("synthetic-unrecognised-signal");
      },
    ],
    [
      "duplicate signal",
      (ledger) => {
        ledger.targets[0]!.safeSignals.push("download-filename-overridden");
      },
    ],
    [
      "over-cap signals",
      (ledger) => {
        ledger.targets[0]!.safeSignals.push(
          ...Array.from({ length: 32 }, (_, index) => `browser-download-id:${index}`),
        );
      },
    ],
    [
      "wrong target identity",
      (ledger) => {
        ledger.targets[0]!.targetId = "GSTR-3B:2026-27:May";
      },
    ],
    [
      "wrong scope binding",
      (ledger) => {
        ledger.targets[0]!.financialYear = "2025-26";
      },
    ],
    [
      "incomplete canonical plan",
      (ledger) => {
        ledger.targetPlan!.push({
          ...ledger.targetPlan![0]!,
          targetId: "GSTR-3B:2026-27:May",
          period: "May",
        });
      },
    ],
  ])("rejects historical filename cache with %s", async (_reason, corrupt) => {
    const ledger = createHistoricalBlockedFilenameLedger();
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    corrupt(ledger);
    mockLocalStorageGet({ "full-year-ledger": ledger });

    await expect(readLedger("full-year-ledger")).resolves.toBeNull();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
  });

  it("keeps target-bound diagnostics required for an exact historical filename cache", async () => {
    const ledger = createHistoricalBlockedFilenameLedger();
    ledger.targets[0]!.downloadDiagnostic = {
      actionId: "00000000-0000-4000-8000-000000000081",
      artifactType: "PDF",
      byteCountClass: "non-empty",
      downloadPathClass: "captured-portal-request-data",
      endpointClass: "gstr3b-portal-blob-captured-download",
      eventType: "filed-return-download-path",
      financialYear: "2026-27",
      mimeClass: "pdf",
      period: "April",
      returnType: "GSTR-3B",
      schemaVersion: "1.0",
      status: "downloaded",
    };
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    ledger.targets[0]!.downloadDiagnostic.period = "May";
    mockLocalStorageGet({ "full-year-ledger": ledger });

    await expect(readLedger("full-year-ledger")).resolves.toBeNull();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
  });

  it.each([
    ["downloaded", "Pack confirmed the filed-return download for April."],
    ["not-filed", "The GST Portal reported no filed return for the selected period."],
  ] as const)(
    "does not let historical filename copy prove a %s target",
    async (status, baseCopy) => {
      const ledger = createHistoricalBlockedFilenameLedger();
      const target = ledger.targets[0]!;
      target.status = status;
      target.safeMessage = `${baseCopy} Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.`;
      if (status === "not-filed") {
        expect(
          isHistoricalDurableTargetMessage(target, status, target.safeSignals, target.safeMessage),
        ).toBe(true);
      } else {
        expect(canonicalDurableTargetStatus(target, status, target.safeSignals).safeMessage).toBe(
          target.safeMessage,
        );
      }
      mockLocalStorageGet({ "full-year-ledger": ledger });

      await expect(readLedger("full-year-ledger")).resolves.toBeNull();
      expect(browser.storage.local.set).not.toHaveBeenCalled();
      expect(browser.storage.local.remove).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "wrong ledger",
      { ledgerId: "full-fiscal-year-87654321" },
      "full-fiscal-year-ledger-not-found",
    ],
    ["wrong target", { targetId: "GSTR-3B:2026-27:May" }, "full-fiscal-year-target-not-found"],
    ["stale revision", { expectedRevision: 1 }, "full-fiscal-year-recovery-stale"],
  ] as const)(
    "keeps historical-cache retry guarded against %s",
    async (_reason, overrides, signal) => {
      const ledger = createHistoricalBlockedFilenameLedger();
      mockLocalStorageGet({ "full-year-ledger": ledger });

      const result = await prepareFullFiscalYearTargetRetry(
        {
          ledgerId: LEDGER_ID,
          targetId: "GSTR-3B:2026-27:April",
          expectedRevision: 2,
          ...overrides,
        },
        recoveryDeps(),
      );

      expect(result).toMatchObject({
        ok: false,
        response: { flowStep: { safeSignals: [signal] } },
      });
      expect(browser.storage.local.set).not.toHaveBeenCalled();
      expect(browser.storage.local.remove).not.toHaveBeenCalled();
      expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    },
  );

  it.each(["overridden", "unavailable"] as const)(
    "requires historical mixed-signal copy to preserve override precedence (%s)",
    async (oldFamily) => {
      const ledger = createHistoricalBlockedFilenameLedger();
      ledger.targets[0]!.safeSignals.push("download-filename-unavailable");
      if (oldFamily === "unavailable") {
        ledger.targets[0]!.safeMessage = ledger.targets[0]!.safeMessage.replace(
          "the browser saved it under a different name",
          "could not confirm its saved filename",
        );
      }
      mockLocalStorageGet({ "full-year-ledger": ledger });

      const read = await readLedger("full-year-ledger");

      if (oldFamily === "overridden") {
        expect(read).not.toBeNull();
        expect(summariseFullFiscalYearLedger(read!).flowStep.safeMessage).toContain(
          "Pack could not verify that any file belongs to this unresolved target",
        );
      } else {
        expect(read).toBeNull();
      }
      expect(browser.storage.local.set).not.toHaveBeenCalled();
      expect(browser.storage.local.remove).not.toHaveBeenCalled();
    },
  );

  it.each([
    "filed-return-download-target-mismatch",
    "filed-gstr3b-direct-download-action-mismatch",
    "filed-gstr3b-direct-download-start-rejected",
    "filed-gstr3b-direct-download-target-rejected",
    "filed-return-download-diagnostics-rejected",
  ])("keeps historical filename cache blocked with %s", async (contradiction) => {
    const ledger = createHistoricalBlockedFilenameLedger();
    ledger.targets[0]!.safeSignals.push(
      "browser-download-completed",
      "browser-download-id:81",
      "browser-download-non-empty",
      contradiction,
    );
    mockLocalStorageGet({ "full-year-ledger": ledger });

    const read = await readLedger("full-year-ledger");

    expect(read).not.toBeNull();
    expect(read?.targets[0]?.status).toBe("blocked");
    const summary = summariseFullFiscalYearLedger(read!);
    expect(summary).toMatchObject({
      status: "blocked",
      fullFiscalYearRecovery: { targetStatus: "blocked", expectedRevision: 2 },
      flowStep: { state: "blocked", safeSignals: expect.arrayContaining([contradiction]) },
    });
    expect(summary.flowStep.safeMessage).not.toContain("Pack completed the download");
    expect(summary.flowStep.safeMessage).toContain(
      "Pack could not verify that any file belongs to this unresolved target",
    );
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
  });

  it.each([
    [
      "failed",
      [],
      "Pack stopped while processing April. Retry this period, or discard the saved run and start again.",
    ],
    [
      "blocked",
      ["single-period-opfs-clear-failed"],
      "Pack cannot complete this review while temporary selected-file staging remains uncleared.",
    ],
  ] as const)(
    "preserves historical %s recovery and its specific cause",
    async (status, signals, baseCopy) => {
      const ledger = createRecoveryLedger({
        revision: 2,
        targetStatus: status,
        safeSignals: ["download-filename-unavailable", ...signals],
      });
      ledger.targets[0]!.safeMessage = `${baseCopy} Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.`;
      mockLocalStorageGet({ "full-year-ledger": ledger });

      const read = await readLedger("full-year-ledger");

      expect(read).not.toBeNull();
      expect(read?.targets[0]?.status).toBe(status);
      const summary = summariseFullFiscalYearLedger(read!);
      expect(summary.fullFiscalYearRecovery?.targetStatus).toBe(status);
      expect(summary.flowStep.safeMessage).toBe(
        `${baseCopy} Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.`,
      );
      expect(browser.storage.local.set).not.toHaveBeenCalled();
      expect(browser.storage.local.remove).not.toHaveBeenCalled();
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    },
  );

  it("keeps historical completion wording from supplying final-click evidence", async () => {
    const ledger = createHistoricalBlockedFilenameLedger();
    mockLocalStorageGet({ "full-year-ledger": ledger });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "manually-observed",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      flowStep: { safeSignals: ["full-fiscal-year-manual-observation-unavailable"] },
    });
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
  });

  it("still rejects a complete legacy ledger with a historical filename cache", async () => {
    const ledger = createHistoricalBlockedFilenameLedger();
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    ledger.status = "complete";
    delete ledger.planVersion;
    delete ledger.targetPlan;
    mockLocalStorageGet({ "full-year-ledger": ledger });

    await expect(readLedger("full-year-ledger")).resolves.toBeNull();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
  });

  it("migrates an incomplete legacy ledger before presenting its recovery action", async () => {
    const ledger = createHistoricalBlockedFilenameLedger();
    delete ledger.planVersion;
    delete ledger.eligibleThrough;
    delete ledger.targetPlan;
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    mockLocalStorageGet({ "full-year-ledger": ledger });
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };

    const response = await startFullFiscalYearDownloadFlow(scope, recoveryDeps() as never, vi.fn());

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.not.arrayContaining(["full-fiscal-year-target-plan-invalid"]),
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
        eligibleThrough: "April",
        targetPlan: [expect.objectContaining({ period: "April" })],
      }),
    });
  });

  it("keeps interrupted running historical targets non-retryable", async () => {
    const ledger = createRecoveryLedger({
      revision: 2,
      targetStatus: "running",
      safeSignals: ["download-filename-overridden"],
    });
    ledger.targets[0]!.safeMessage =
      "Checking April. Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.";
    mockLocalStorageGet({ "full-year-ledger": ledger });

    const result = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(result).toMatchObject({
      ok: false,
      response: { flowStep: { safeSignals: ["full-fiscal-year-run-interrupted"] } },
    });
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
  });

  it("uses the existing explicit retry transition for a historical filename cache", async () => {
    const ledger = createHistoricalBlockedFilenameLedger();
    mockLocalStorageGet({ "full-year-ledger": ledger });

    const result = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(result).toMatchObject({
      ok: true,
      ledger: {
        ledgerId: LEDGER_ID,
        revision: 3,
        targets: [expect.objectContaining({ status: "pending", attempts: 1 })],
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(browser.storage.local.set).mock.calls)).not.toContain(
      "Pack completed the download",
    );
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
  });

  it("does not treat a historically valid filename cache as malformed fresh-start data", async () => {
    const ledger = createHistoricalBlockedFilenameLedger();
    mockLocalStorageGet({ "full-year-ledger": ledger });

    const result = await discardMalformedFullFiscalYearRunForFreshStart(
      {
        ledgerId: LEDGER_ID,
        scope: ledger.scope,
      },
      recoveryDeps(),
    );

    expect(result).toEqual({ state: "unavailable" });
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
  });

  it("discards only the matching malformed ledger for an explicit fresh start", async () => {
    mockLocalStorageGet({
      "full-year-ledger": {
        ledgerId: LEDGER_ID,
        schemaVersion: "unexpected",
      },
    });

    const result = await discardMalformedFullFiscalYearRunForFreshStart(
      {
        ledgerId: LEDGER_ID,
        scope: {
          artifactType: "PDF",
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
      },
      recoveryDeps(),
    );

    expect(result).toEqual({ state: "discarded" });
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(LEDGER_ID);
    expect(browser.storage.local.remove).toHaveBeenCalledWith("full-year-ledger");
    expect(browser.storage.local.remove).toHaveBeenCalledTimes(1);
  });

  it("does not discard a malformed ledger for a different recovery control", async () => {
    mockLocalStorageGet({
      "full-year-ledger": {
        ledgerId: LEDGER_ID,
        schemaVersion: "unexpected",
      },
    });

    const result = await discardMalformedFullFiscalYearRunForFreshStart(
      {
        ledgerId: "full-fiscal-year-87654321",
        scope: {
          artifactType: "PDF",
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
      },
      recoveryDeps(),
    );

    expect(result).toEqual({ state: "unavailable" });
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
  });

  it("keeps an uncorrelated final ZIP intent in manual review instead of exporting again", async () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-1" as const,
    };
    const periods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now);
    const baseLedger = createFullFiscalYearLedger(scope, now, periods);
    const ledger: FiledReturnsFullFiscalYearLedger = {
      ...baseLedger,
      status: "blocked",
      zipPhase: "download-intent-persisted",
      zipDownloadAttempt: { requestedAt: now.toISOString() },
      targets: baseLedger.targets.map((target, index) => {
        const targetScope = {
          artifactType: "PDF" as const,
          financialYear: target.financialYear,
          period: target.period,
          returnType: target.returnType,
        };
        return {
          ...target,
          status: "downloaded" as const,
          ...canonicalDurableTargetStatus(targetScope, "downloaded", [
            "filed-return-artifact-downloaded:PDF",
            "full-fiscal-year-opfs-staged:PDF",
          ]),
          downloadDiagnostic: {
            actionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            artifactType: "PDF" as const,
            byteCountClass: "non-empty" as const,
            downloadPathClass: "captured-portal-request-data" as const,
            endpointClass: "gstr1-pdf-portal-blob-captured-download" as const,
            eventType: "filed-return-download-path" as const,
            financialYear: target.financialYear,
            mimeClass: "pdf" as const,
            period: target.period,
            returnType: "GSTR-1" as const,
            schemaVersion: "1.0" as const,
            status: "downloaded" as const,
          },
        };
      }),
    };
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    mockLocalStorageGet({ "full-year-ledger": ledger });
    const staleStep = fullFiscalYearZipPhaseStep(ledger)!;
    const staleUpdatedAt = "2026-06-23T23:59:59.000Z";
    await persistCanonicalFiledReturnsFlowSummary(
      "completion",
      toFullFiscalYearSummary(
        { ...ledger, updatedAt: staleUpdatedAt },
        {
          ...staleStep,
          safeSignals: [
            ...staleStep.safeSignals,
            "full-fiscal-year-summary-included",
            "full-fiscal-year-summary-parsed-period-count:1",
            "full-fiscal-year-summary-row-count:1",
          ],
        },
      ),
    );

    const response = await startFullFiscalYearDownloadFlow(scope, recoveryDeps() as never, vi.fn());

    expect(response).toMatchObject({
      flowStep: {
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining(["full-fiscal-year-final-zip-manual-review"]),
      },
    });
    if (!("flowStep" in response)) throw new Error("expected a filed-returns flow response");
    expect(response.flowStep.safeSignals).not.toContain("full-fiscal-year-summary-included");
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        zipPhase: "download-intent-persisted",
        zipDownloadAttempt: { requestedAt: now.toISOString() },
      }),
    });
  });

  it("reconciles only the exact persisted full-year ZIP download", async () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const baseLedger = createFullFiscalYearLedger(
      scope,
      now,
      getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now),
    );
    const ledger: FiledReturnsFullFiscalYearLedger = {
      ...baseLedger,
      status: "blocked",
      zipPhase: "download-observing",
      zipDownloadAttempt: { downloadId: 41, requestedAt: now.toISOString() },
      targets: baseLedger.targets.map((target, index) => ({
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
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    mockLocalStorageGet({ "full-year-ledger": ledger });
    zipMocks.reconcileFullFiscalYearZipDownload.mockResolvedValue({
      connectorId: "gst",
      scopeId: "gst-gstr3b-private-v0",
      state: "downloaded",
      safeSignals: ["browser-download-completed"],
      safeMessage: "Pack confirmed the final ZIP download.",
    });

    await expect(
      reconcilePendingFullFiscalYearZipDownload(40, recoveryDeps() as never),
    ).resolves.toBe(false);
    expect(zipMocks.reconcileFullFiscalYearZipDownload).not.toHaveBeenCalled();

    await expect(
      reconcilePendingFullFiscalYearZipDownload(41, recoveryDeps() as never),
    ).resolves.toBe(true);
    expect(zipMocks.reconcileFullFiscalYearZipDownload).toHaveBeenCalledOnce();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(ledger.ledgerId);
    zipMocks.reconcileFullFiscalYearZipDownload.mockClear();

    await expect(
      reconcilePersistedFullFiscalYearZipDownload(recoveryDeps() as never),
    ).resolves.toBe(true);
    expect(zipMocks.reconcileFullFiscalYearZipDownload).toHaveBeenCalledOnce();
    vi.mocked(browser.storage.local.get).mockImplementation(async () => ({}));
  });

  it("reconciles every exact final-ZIP ID when independently saved plans coexist", async () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    const first = createObservingZipLedger("2025-26", "full-fiscal-year-12345679", 51, now);
    const second = createObservingZipLedger("2026-27", "full-fiscal-year-12345680", 52, now);
    const indexKey = "full-year-ledger-index";
    const firstKey = `pack:filed-returns-plan:${first.ledgerId}`;
    const secondKey = `pack:filed-returns-plan:${second.ledgerId}`;
    mockLocalStorageGet({
      [indexKey]: {
        schemaVersion: "1.0",
        ledgerIdsByScope: {
          "GSTR-3B:2025-26:PDF": first.ledgerId,
          "GSTR-3B:2026-27:PDF": second.ledgerId,
        },
      },
      [firstKey]: first,
      [secondKey]: second,
    });
    zipMocks.reconcileFullFiscalYearZipDownload.mockResolvedValue({
      connectorId: "gst",
      scopeId: "gst-gstr3b-private-v0",
      state: "downloaded",
      safeSignals: ["browser-download-completed"],
      safeMessage: "Pack confirmed the final ZIP download.",
    });

    await expect(
      reconcilePersistedFullFiscalYearZipDownload({
        ...recoveryDeps(),
        storageKeys: {
          ...recoveryDeps().storageKeys,
          fullFiscalYearLedgerIndex: indexKey,
        },
      } as never),
    ).resolves.toBe(true);
    expect(zipMocks.reconcileFullFiscalYearZipDownload).toHaveBeenCalledTimes(2);
    expect(
      zipMocks.reconcileFullFiscalYearZipDownload.mock.calls.map(([ledger]) => ledger.ledgerId),
    ).toEqual([first.ledgerId, second.ledgerId]);
  });

  it("moves duplicate final-ZIP ID owners to review without reusing the browser completion", async () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    const first = createObservingZipLedger("2025-26", "full-fiscal-year-12345679", 51, now);
    const second = createObservingZipLedger("2026-27", "full-fiscal-year-12345680", 51, now);
    const indexKey = "full-year-ledger-index";
    const firstKey = `pack:filed-returns-plan:${first.ledgerId}`;
    const secondKey = `pack:filed-returns-plan:${second.ledgerId}`;
    mockLocalStorageGet({
      [indexKey]: {
        schemaVersion: "1.0",
        ledgerIdsByScope: {
          "GSTR-3B:2025-26:PDF": first.ledgerId,
          "GSTR-3B:2026-27:PDF": second.ledgerId,
        },
      },
      [firstKey]: first,
      [secondKey]: second,
    });

    await expect(
      reconcilePersistedFullFiscalYearZipDownload({
        ...recoveryDeps(),
        storageKeys: {
          ...recoveryDeps().storageKeys,
          fullFiscalYearLedgerIndex: indexKey,
        },
      } as never),
    ).resolves.toBe(true);
    expect(zipMocks.reconcileFullFiscalYearZipDownload).not.toHaveBeenCalled();
    const persistedPlans = vi
      .mocked(browser.storage.local.set)
      .mock.calls.flatMap(([values]) => Object.values(values as Record<string, unknown>))
      .filter(isFullFiscalYearLedger);
    expect(persistedPlans.map((ledger) => ledger.zipPhase)).toEqual([
      "download-intent-persisted",
      "download-intent-persisted",
    ]);
  });

  it("moves duplicate final-ZIP ID owners to review before scoped Start can reconcile either one", async () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    const first = createObservingZipLedger("2025-26", "full-fiscal-year-12345679", 51, now);
    const second = createObservingZipLedger("2026-27", "full-fiscal-year-12345680", 51, now);
    const indexKey = "full-year-ledger-index";
    const firstKey = `pack:filed-returns-plan:${first.ledgerId}`;
    const secondKey = `pack:filed-returns-plan:${second.ledgerId}`;
    mockLocalStorageGet({
      [indexKey]: {
        schemaVersion: "1.0",
        ledgerIdsByScope: {
          "GSTR-3B:2025-26:PDF": first.ledgerId,
          "GSTR-3B:2026-27:PDF": second.ledgerId,
        },
      },
      [firstKey]: first,
      [secondKey]: second,
    });
    const runSinglePeriod = vi.fn();

    const response = await startFullFiscalYearDownloadFlow(
      first.scope,
      {
        ...recoveryDeps(),
        storageKeys: {
          ...recoveryDeps().storageKeys,
          fullFiscalYearLedgerIndex: indexKey,
        },
      } as never,
      runSinglePeriod,
    );

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining(["full-fiscal-year-final-zip-manual-review"]),
      },
    });
    expect(zipMocks.reconcileFullFiscalYearZipDownload).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    expect(runSinglePeriod).not.toHaveBeenCalled();
    const persistedPlans = vi
      .mocked(browser.storage.local.set)
      .mock.calls.flatMap(([values]) => Object.values(values as Record<string, unknown>))
      .filter(isFullFiscalYearLedger);
    expect(persistedPlans.map((ledger) => ledger.zipPhase)).toEqual([
      "download-intent-persisted",
      "download-intent-persisted",
    ]);
  });

  it("retains the summary outcome across repeated observing reconciliation", async () => {
    const requestedAt = new Date("2017-08-20T00:00:00.000Z");
    let clock = new Date("2017-08-20T00:01:00.000Z");
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2017-18",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const baseLedger = createFullFiscalYearLedger(
      scope,
      requestedAt,
      getFiledReturnsFullFiscalYearPeriods(scope.financialYear, requestedAt),
    );
    const ledger: FiledReturnsFullFiscalYearLedger = {
      ...baseLedger,
      status: "blocked",
      zipPhase: "download-observing",
      zipDownloadAttempt: { downloadId: 41, requestedAt: requestedAt.toISOString() },
      targets: baseLedger.targets.map((target, index) => ({
        ...target,
        status: "downloaded" as const,
        ...canonicalDurableTargetStatus({ ...scope, period: target.period }, "downloaded", [
          "filed-return-artifact-downloaded:PDF",
          "full-fiscal-year-opfs-staged:PDF",
        ]),
        completedAt: requestedAt.toISOString(),
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
    const store: Record<string, unknown> = { "full-year-ledger": ledger };
    vi.mocked(browser.storage.local.get).mockImplementation(async (key: unknown) => {
      if (typeof key === "string") return { [key]: store[key] };
      return store;
    });
    vi.mocked(browser.storage.local.set).mockImplementation(
      async (values: Record<string, unknown>) => {
        Object.assign(store, values);
      },
    );
    const intentLedger = { ...ledger, zipPhase: "download-intent-persisted" as const };
    const intentStep = fullFiscalYearZipPhaseStep(intentLedger)!;
    await persistCanonicalFiledReturnsFlowSummary(
      "completion",
      toFullFiscalYearSummary(intentLedger, {
        ...intentStep,
        safeSignals: [
          ...intentStep.safeSignals,
          "full-fiscal-year-summary-included",
          "full-fiscal-year-summary-parsed-period-count:1",
          "full-fiscal-year-summary-row-count:4",
        ],
      }),
    );
    zipMocks.reconcileFullFiscalYearZipDownload
      .mockResolvedValueOnce({
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "download-unconfirmed",
        safeSignals: [
          "full-fiscal-year-zip-download-started",
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-zip-reconciled-by-id",
          "browser-download-in-progress",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage: "Synthetic exact ZIP download is still in progress.",
      })
      .mockResolvedValueOnce({
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: [
          "full-fiscal-year-zip-download-started",
          "full-fiscal-year-zip-downloaded",
          "full-fiscal-year-zip-reconciled-by-id",
          "browser-download-completed",
          "browser-download-non-empty",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage: "Synthetic exact ZIP download completed.",
      });

    const firstRecovery = await startFullFiscalYearDownloadFlow(
      scope,
      { ...recoveryDeps(), now: () => clock } as never,
      vi.fn(),
    );
    clock = new Date("2017-08-20T00:02:00.000Z");
    const secondRecovery = await startFullFiscalYearDownloadFlow(
      scope,
      { ...recoveryDeps(), now: () => clock } as never,
      vi.fn(),
    );

    for (const recovered of [firstRecovery, secondRecovery]) {
      expect(recovered).toMatchObject({
        flowStep: {
          safeSignals: expect.arrayContaining([
            "full-fiscal-year-summary-included",
            "full-fiscal-year-summary-parsed-period-count:1",
            "full-fiscal-year-summary-row-count:4",
          ]),
          safeMessage: expect.stringContaining("workbook and tidy CSV for 1 period"),
        },
      });
    }
    expect(zipMocks.reconcileFullFiscalYearZipDownload).toHaveBeenCalledTimes(2);
  });

  it("stages GSTR-3B targets before progressing to one ZIP export", async () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const runSinglePeriod = vi.fn(async (_scope, _deps, options) => {
      await options?.onPortalTabSelected?.(41, "synthetic-browser-session-marker");
      return {
        ok: true as const,
        flowStep: {
          connectorId: "gst" as const,
          scopeId: "gst-gstr3b-private-v0",
          state: "downloaded" as const,
          safeSignals: ["filed-return-artifact-downloaded:PDF", "full-fiscal-year-opfs-staged:PDF"],
          safeMessage: "Pack staged the selected artifacts for the fiscal-year ZIP.",
        },
      };
    });
    zipMocks.exportFullFiscalYearZip.mockResolvedValue({
      connectorId: "gst",
      scopeId: "gst-gstr3b-private-v0",
      state: "download-unconfirmed",
      safeSignals: ["browser-download-not-observed"],
      safeMessage: "Pack started ZIP delivery but needs exact browser download confirmation.",
    });

    const response = await startFullFiscalYearDownloadFlow(
      scope,
      { ...recoveryDeps(), now: () => now } as never,
      runSinglePeriod,
    );

    expect(runSinglePeriod).toHaveBeenCalled();
    expect(runSinglePeriod).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stageCapturedDownloads: expect.objectContaining({ bundleKind: "full-fiscal-year" }),
      }),
      expect.objectContaining({
        onPortalTabSelected: expect.any(Function),
        persistSinglePeriodSummary: false,
      }),
    );
    expect(zipMocks.exportFullFiscalYearZip).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      flowStep: {
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining(["browser-download-not-observed"]),
      },
    });
  });

  it("keeps the workbook-not-applicable outcome visible through immediate ZIP cleanup without adding it to the ledger", async () => {
    const now = new Date("2017-08-20T00:00:00.000Z");
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2017-18",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-1" as const,
    };
    const runSinglePeriod = vi.fn(async () => ({
      ok: true as const,
      flowStep: {
        connectorId: "gst" as const,
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "downloaded" as const,
        safeSignals: ["filed-return-artifact-downloaded:PDF", "full-fiscal-year-opfs-staged:PDF"],
        safeMessage: "Synthetic PDF staged.",
      },
    }));
    zipMocks.exportFullFiscalYearZip.mockResolvedValue({
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "downloaded",
      safeSignals: [
        "full-fiscal-year-zip-downloaded",
        "full-fiscal-year-summary-included",
        "full-fiscal-year-workbook-not-applicable",
        "full-fiscal-year-summary-parsed-period-count:1",
        "full-fiscal-year-summary-row-count:1",
      ],
      safeMessage: "Synthetic ZIP and summary downloaded.",
    });

    const response = await startFullFiscalYearDownloadFlow(
      scope,
      { ...recoveryDeps(), now: () => now } as never,
      runSinglePeriod,
    );

    expect(response).toMatchObject({
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-zip-downloaded",
          "full-fiscal-year-summary-included",
          "full-fiscal-year-workbook-not-applicable",
          "full-fiscal-year-summary-parsed-period-count:1",
        ]),
      },
    });
    if (!("flowStep" in response)) throw new Error("Expected a filed-return flow response.");
    expect(response.flowStep.safeMessage).toContain(
      "tidy CSV for 1 period. A consolidated workbook is not available",
    );
    const durableWrites = vi.mocked(browser.storage.local.set).mock.calls;
    expect(JSON.stringify(durableWrites)).not.toContain("full-fiscal-year-summary-included");
  });

  it("restores workbook-not-applicable status from session persistence during restart cleanup", async () => {
    const now = new Date("2017-08-20T00:00:00.000Z");
    const scope = {
      artifactType: "JSON" as const,
      financialYear: "2017-18",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-2B" as const,
    };
    const periods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now);
    const baseLedger = createFullFiscalYearLedger(scope, now, periods);
    const cleanupLedger: FiledReturnsFullFiscalYearLedger = {
      ...baseLedger,
      status: "blocked",
      zipPhase: "downloaded-cleanup-pending",
      targets: baseLedger.targets.map((target) => ({
        ...target,
        status: "not-filed" as const,
        safeSignals: ["not-filed"],
        safeMessage: "Pack did not find a filed return for this period.",
      })),
    };
    await persistCanonicalFiledReturnsFlowSummary("completion", {
      scope,
      status: "blocked",
      updatedAt: now.toISOString(),
      completedPeriods: [],
      totalPeriods: 12,
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnsScopeId("GSTR-2B"),
        state: "blocked",
        safeSignals: [
          "full-fiscal-year-local-cleanup-retry",
          "full-fiscal-year-summary-included",
          "full-fiscal-year-workbook-not-applicable",
          "full-fiscal-year-summary-parsed-period-count:2",
          `full-fiscal-year-summary-row-count:${periods.length}`,
        ],
        safeMessage: "Synthetic supplied summary status.",
      },
    });

    const response = await finishFullFiscalYearCleanup(
      { ...recoveryDeps(), now: () => now } as never,
      cleanupLedger,
    );

    expect(response).toMatchObject({
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-summary-included",
          "full-fiscal-year-workbook-not-applicable",
          "full-fiscal-year-summary-parsed-period-count:2",
        ]),
      },
    });
    if (!response.ok || !("flowStep" in response)) throw new Error("Expected flow response.");
    expect(response.flowStep.safeMessage).toContain(
      "tidy CSV for 2 periods. A consolidated workbook is not available",
    );
  });

  it("restores the intent-checkpoint summary after the cleanup ledger advances", async () => {
    const intentAt = new Date("2017-08-20T00:00:00.000Z");
    const cleanupAt = new Date("2017-08-20T00:01:00.000Z");
    const scope = {
      artifactType: "JSON" as const,
      financialYear: "2017-18",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const periods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, cleanupAt);
    const baseLedger = createFullFiscalYearLedger(scope, intentAt, periods);
    const readyLedger: FiledReturnsFullFiscalYearLedger = {
      ...baseLedger,
      status: "blocked",
      targets: baseLedger.targets.map((target) => {
        const targetScope = {
          artifactType: "JSON" as const,
          financialYear: target.financialYear,
          period: target.period,
          returnType: "GSTR-3B" as const,
        };
        return {
          ...target,
          status: "not-filed" as const,
          ...canonicalDurableTargetStatus(targetScope, "not-filed", [
            "filed-return-positively-not-filed",
          ]),
        };
      }),
    };
    const intentLedger = markFullFiscalYearZipDownloadIntent(readyLedger, intentAt);
    const observingLedger = markFullFiscalYearZipDownloadObserving(intentLedger, cleanupAt, 41);
    const cleanupLedger = createFullFiscalYearCleanupPendingState(observingLedger, {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-zip-downloaded"],
      safeMessage: "Synthetic ZIP downloaded.",
    }).ledger;
    expect(cleanupLedger.updatedAt).toBe(cleanupAt.toISOString());
    expect(cleanupLedger.zipDownloadAttempt).toEqual({ requestedAt: intentAt.toISOString() });
    expect(isFullFiscalYearLedger(cleanupLedger)).toBe(true);
    await persistCanonicalFiledReturnsFlowSummary("completion", {
      scope,
      status: "blocked",
      updatedAt: intentAt.toISOString(),
      completedPeriods: [],
      totalPeriods: 12,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "blocked",
        safeSignals: [
          "full-fiscal-year-zip-phase:download-intent-persisted",
          "full-fiscal-year-summary-included",
          "full-fiscal-year-summary-parsed-period-count:2",
          `full-fiscal-year-summary-row-count:${periods.length}`,
        ],
        safeMessage: "Synthetic intent-checkpoint summary status.",
      },
    });

    const response = await finishFullFiscalYearCleanup(
      { ...recoveryDeps(), now: () => cleanupAt } as never,
      cleanupLedger,
    );

    expect(response).toMatchObject({
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-summary-included",
          "full-fiscal-year-summary-parsed-period-count:2",
        ]),
      },
    });
  });

  it("does not import a previous same-scope run's summary during cleanup recovery", async () => {
    const now = new Date("2017-08-20T00:01:00.000Z");
    const scope = {
      artifactType: "JSON" as const,
      financialYear: "2017-18",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const periods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now);
    const baseLedger = createFullFiscalYearLedger(scope, now, periods);
    const cleanupLedger: FiledReturnsFullFiscalYearLedger = {
      ...baseLedger,
      status: "blocked",
      zipPhase: "no-artifacts-cleanup-pending",
      targets: baseLedger.targets.map((target) => ({
        ...target,
        status: "not-filed" as const,
        safeSignals: ["not-filed"],
        safeMessage: "Pack did not find a filed return for this period.",
      })),
    };
    await persistCanonicalFiledReturnsFlowSummary("completion", {
      scope,
      status: "blocked",
      updatedAt: "2017-08-20T00:00:00.000Z",
      completedPeriods: [],
      totalPeriods: 12,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "blocked",
        safeSignals: [
          "full-fiscal-year-summary-included",
          "full-fiscal-year-summary-parsed-period-count:2",
          `full-fiscal-year-summary-row-count:${periods.length}`,
        ],
        safeMessage: "Synthetic previous-run summary status.",
      },
    });

    const response = await finishFullFiscalYearCleanup(
      { ...recoveryDeps(), now: () => now } as never,
      cleanupLedger,
    );

    expect(response).toMatchObject({
      flowStep: {
        state: "downloaded",
        safeSignals: expect.not.arrayContaining(["full-fiscal-year-summary-included"]),
      },
    });
    if (!response.ok || !("flowStep" in response)) throw new Error("Expected flow response.");
    expect(response.flowStep.safeMessage).not.toContain("summary");
  });

  it.each([
    {
      name: "included",
      returnType: "GSTR-3B" as const,
      outcome: {
        safeSignals: [
          "full-fiscal-year-summary-included",
          "full-fiscal-year-summary-parsed-period-count:1",
          "full-fiscal-year-summary-row-count:4",
        ],
      },
      messageFragment: "workbook and tidy CSV for 1 period",
    },
    {
      name: "outcomes-only",
      returnType: "GSTR-3B" as const,
      outcome: {
        safeSignals: [
          "full-fiscal-year-summary-included",
          "full-fiscal-year-summary-outcomes-only",
          "full-fiscal-year-summary-parsed-period-count:0",
          "full-fiscal-year-summary-row-count:4",
        ],
      },
      messageFragment: "outcome-only tidy CSV",
    },
    {
      name: "failed",
      returnType: "GSTR-3B" as const,
      outcome: {
        safeSignals: [
          "full-fiscal-year-summary-failed",
          "full-fiscal-year-summary-error:generation-failed",
        ],
      },
      messageFragment: "summary generation failed",
    },
    {
      name: "workbook-not-applicable",
      returnType: "GSTR-1" as const,
      outcome: {
        safeSignals: [
          "full-fiscal-year-summary-included",
          "full-fiscal-year-workbook-not-applicable",
          "full-fiscal-year-summary-parsed-period-count:1",
          "full-fiscal-year-summary-row-count:4",
        ],
      },
      messageFragment: "tidy CSV for 1 period. A consolidated workbook is not available",
    },
  ])(
    "restores the $name summary outcome across worker-stop checkpoints",
    async ({ outcome, messageFragment, returnType }) => {
      const stopsAtIntentCheckpoint = outcome.safeSignals.includes(
        "full-fiscal-year-summary-failed",
      );
      const now = new Date("2017-08-20T00:00:00.000Z");
      let clock = now;
      const scope = {
        artifactType: "PDF" as const,
        financialYear: "2017-18",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType,
      };
      const store: Record<string, unknown> = {};
      vi.mocked(browser.storage.local.get).mockImplementation(async (key: unknown) => {
        if (typeof key === "string") return { [key]: store[key] };
        return store;
      });
      vi.mocked(browser.storage.local.set).mockImplementation(
        async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
      );
      const browserDownloadStarted = vi.fn();
      const periods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now);
      const runSinglePeriod = vi.fn(async (targetScope: FiledReturnsDownloadScope) => {
        const periodIndex = periods.findIndex((period) => period === targetScope.period);
        return {
          ok: true as const,
          flowStep: {
            connectorId: "gst" as const,
            scopeId: filedReturnsScopeId(returnType),
            state: "downloaded" as const,
            safeSignals: [
              "filed-return-artifact-downloaded:PDF",
              "full-fiscal-year-opfs-staged:PDF",
            ],
            safeMessage: "Synthetic PDF staged.",
            downloadDiagnostic: {
              actionId: `00000000-0000-4000-8000-${String(periodIndex + 1).padStart(12, "0")}`,
              artifactType: "PDF" as const,
              byteCountClass: "non-empty" as const,
              downloadPathClass: "captured-portal-request-data" as const,
              endpointClass:
                returnType === "GSTR-1"
                  ? ("gstr1-pdf-portal-blob-captured-download" as const)
                  : ("gstr3b-portal-blob-captured-download" as const),
              eventType: "filed-return-download-path" as const,
              financialYear: targetScope.financialYear,
              mimeClass: "pdf" as const,
              period: targetScope.period,
              returnType,
              schemaVersion: "1.0" as const,
              status: "downloaded" as const,
            },
          },
        };
      });
      zipMocks.exportFullFiscalYearZip.mockImplementationOnce(
        async (
          _ledger: FiledReturnsFullFiscalYearLedger,
          _step: unknown,
          options: {
            onBeforeDownloadStart?: (
              requestedAt: Date,
              summaryOutcome: FiledReturnsSummaryStatus,
            ) => Promise<void>;
            onDownloadStarted?: (downloadId: number) => Promise<void>;
          },
        ) => {
          await options.onBeforeDownloadStart?.(now, outcome);
          if (stopsAtIntentCheckpoint) {
            throw new Error("synthetic worker termination after ZIP intent checkpoint");
          }
          browserDownloadStarted();
          throw new Error("synthetic worker termination after ZIP download start");
        },
      );

      await expect(
        startFullFiscalYearDownloadFlow(
          scope,
          { ...recoveryDeps(), now: () => clock } as never,
          runSinglePeriod,
        ),
      ).rejects.toThrow(
        stopsAtIntentCheckpoint
          ? "synthetic worker termination after ZIP intent checkpoint"
          : "synthetic worker termination after ZIP download start",
      );

      const checkpoint = sessionValues.current.completion as {
        flowStep?: { safeMessage?: string; safeSignals?: unknown };
      };
      const durableSignals = parseDurableFiledReturnsSignals(checkpoint.flowStep?.safeSignals);
      expect(durableSignals).toEqual(expect.arrayContaining(outcome.safeSignals));
      if (stopsAtIntentCheckpoint) {
        expect(checkpoint.flowStep?.safeMessage).toContain("prepared the artifact ZIP");
        expect(checkpoint.flowStep?.safeMessage).toContain("summary generation failed");
        expect(checkpoint.flowStep?.safeMessage).not.toContain("saved");
      }
      expect(store["full-year-ledger"]).toMatchObject({
        zipPhase: "download-intent-persisted",
        zipDownloadAttempt: { requestedAt: now.toISOString() },
      });
      expect(isFullFiscalYearLedger(store["full-year-ledger"])).toBe(true);
      expect(browserDownloadStarted).toHaveBeenCalledTimes(stopsAtIntentCheckpoint ? 0 : 1);

      clock = new Date("2017-08-20T00:01:00.000Z");
      const firstRecovery = await startFullFiscalYearDownloadFlow(
        scope,
        { ...recoveryDeps(), now: () => clock } as never,
        vi.fn(),
      );
      expect(firstRecovery).toMatchObject({
        flowStep: {
          state: "download-unconfirmed",
          safeSignals: expect.arrayContaining([
            ...outcome.safeSignals,
            "full-fiscal-year-final-zip-manual-review",
          ]),
          safeMessage: expect.stringContaining(messageFragment),
        },
      });
      if (stopsAtIntentCheckpoint && firstRecovery.ok && "flowStep" in firstRecovery) {
        expect(firstRecovery.flowStep.safeMessage).not.toContain("saved");
        expect(firstRecovery.flowStep.safeMessage).toContain("summary generation failed");
      }
      clock = new Date("2017-08-20T00:02:00.000Z");
      const secondRecovery = await startFullFiscalYearDownloadFlow(
        scope,
        { ...recoveryDeps(), now: () => clock } as never,
        vi.fn(),
      );

      expect(secondRecovery).toMatchObject({
        flowStep: {
          state: "download-unconfirmed",
          safeSignals: expect.arrayContaining([
            ...outcome.safeSignals,
            "full-fiscal-year-final-zip-manual-review",
          ]),
          safeMessage: expect.stringContaining(messageFragment),
        },
      });
      expect(zipMocks.reconcileFullFiscalYearZipDownload).not.toHaveBeenCalled();
      expect(zipMocks.exportFullFiscalYearZip).toHaveBeenCalledTimes(1);
    },
  );

  it("passes a fresh GSTR-1 all-formats target to the period flow without narrowing it", async () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-1" as const,
    };
    const runSinglePeriod = vi.fn(async () => ({
      ok: true as const,
      flowStep: {
        connectorId: "gst" as const,
        scopeId: "synthetic-gstr1-all-formats",
        state: "blocked" as const,
        safeSignals: ["synthetic-stop-before-artifact-acquisition"],
        safeMessage: "Synthetic stop.",
      },
    }));

    await startFullFiscalYearDownloadFlow(
      scope,
      { ...recoveryDeps(), now: () => now } as never,
      runSinglePeriod,
    );

    expect(runSinglePeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactType: "PDF_AND_EXCEL",
        period: "April",
        returnType: "GSTR-1",
      }),
      expect.anything(),
      expect.objectContaining({
        onPortalTabSelected: expect.any(Function),
        persistSinglePeriodSummary: false,
      }),
    );
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
  });

  it("records only the preceding fixed action category when a full-year target reaches a portal system error", async () => {
    mockLocalStorageGet({});
    const now = new Date("2026-06-24T00:00:00.000Z");
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-1" as const,
    };
    const runSinglePeriod = vi.fn(async (_scope, deps) => {
      deps.onFlowStepObservation?.({
        category: "detail-navigation",
        portalSystemError: false,
      });
      deps.onFlowStepObservation?.({
        category: "other",
        portalSystemError: true,
      });
      return {
        ok: true as const,
        flowStep: {
          connectorId: "gst" as const,
          scopeId: "synthetic-gstr1",
          state: "blocked" as const,
          safeSignals: ["portal-system-error"],
          safeMessage: "Synthetic portal system error.",
        },
      };
    });

    const response = await startFullFiscalYearDownloadFlow(
      scope,
      { ...recoveryDeps(), now: () => now } as never,
      runSinglePeriod,
    );

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "portal-system-error",
          "full-fiscal-year-system-error-preceded-by:detail-navigation",
        ]),
      },
    });
  });

  it("passes only the unstaged GSTR-1 artifact to a resumed period flow", async () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-1" as const,
    };
    const ledger = createFullFiscalYearLedger(
      scope,
      now,
      getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now),
    );
    const firstTarget = ledger.targets[0]!;
    ledger.status = "running";
    ledger.targets[0] = {
      ...firstTarget,
      safeSignals: canonicalDurableTargetStatus(
        {
          artifactType: "PDF_AND_EXCEL",
          financialYear: firstTarget.financialYear,
          period: firstTarget.period,
          returnType: "GSTR-1",
        },
        "pending",
        ["full-fiscal-year-opfs-staged:PDF"],
      ).safeSignals,
    };
    mockLocalStorageGet({ "full-year-ledger": ledger });
    const runSinglePeriod = vi.fn(async () => ({
      ok: true as const,
      flowStep: {
        connectorId: "gst" as const,
        scopeId: "synthetic-gstr1-excel-retry",
        state: "blocked" as const,
        safeSignals: ["synthetic-stop-before-artifact-acquisition"],
        safeMessage: "Synthetic stop.",
      },
    }));

    await startFullFiscalYearDownloadFlow(
      scope,
      { ...recoveryDeps(), now: () => now } as never,
      runSinglePeriod,
      { allowExistingLedgerResume: true },
    );

    expect(runSinglePeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactType: "EXCEL",
        period: "April",
        returnType: "GSTR-1",
      }),
      expect.anything(),
      expect.objectContaining({
        onPortalTabSelected: expect.any(Function),
        persistSinglePeriodSummary: false,
      }),
    );
  });

  it("resets one recoverable target for retry and clears legacy single-period review state", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({ revision: 2 }),
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-3B:2026-27:April",
        status: "download-unconfirmed",
        scope: {
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-3B",
        },
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Unconfirmed.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    const recovery = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(recovery).toMatchObject({
      ok: true,
      ledger: {
        revision: 3,
        status: "running",
        currentTargetId: "GSTR-3B:2026-27:April",
        targets: [expect.objectContaining({ period: "April", status: "pending" })],
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        revision: 3,
        targets: [expect.objectContaining({ status: "pending" })],
      }),
    });
    expect(browser.storage.local.remove).toHaveBeenCalledWith("target-review");
  });

  it("allows an explicitly cancelled target to be retried after user review", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "cancelled",
        safeSignals: ["full-fiscal-year-target-cancelled"],
      }),
    });

    const recovery = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(recovery).toMatchObject({
      ok: true,
      ledger: {
        revision: 3,
        status: "running",
        targets: [expect.objectContaining({ period: "April", status: "pending" })],
      },
    });
  });

  it("blocks retry of an interrupted running target without replaying a possible orphan stage", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "running",
        safeSignals: ["full-fiscal-year-target-running"],
      }),
    });

    const recovery = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(recovery).toMatchObject({
      ok: false,
      response: {
        flowStep: {
          safeSignals: ["full-fiscal-year-run-interrupted"],
          state: "user-action-required",
        },
      },
    });
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
    expect(browser.storage.session.set).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
  });

  it("discards a pending full-year resume without leaving a recoverable target", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "pending",
        safeSignals: ["full-fiscal-year-resume-confirmation-required"],
      }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "cancelled",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["full-fiscal-year-run-discarded", "full-fiscal-year-opfs-cleared"],
      },
      flowSummary: {
        status: "cancelled",
        currentPeriod: "April",
      },
    });
    expect(JSON.stringify(response)).not.toContain("fullFiscalYearRecovery");
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(LEDGER_ID);
    expect(browser.storage.local.remove).toHaveBeenCalledWith("full-year-ledger");
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        status: "cancelled",
      }),
    });
  });

  it("discards an interrupted running target through exact run cleanup", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "running",
        safeSignals: ["full-fiscal-year-target-running"],
      }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "cancelled",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["full-fiscal-year-run-discarded", "full-fiscal-year-opfs-cleared"],
      },
      flowSummary: {
        status: "cancelled",
        currentPeriod: "April",
      },
    });
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(LEDGER_ID);
    expect(browser.storage.local.remove).toHaveBeenCalledWith("full-year-ledger");
  });

  it("discards a blocked full-year run without leaving the saved ledger", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "blocked",
        safeSignals: ["filed-return-result-row-not-found"],
      }),
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-1:2025-26:May",
        status: "download-unconfirmed",
        scope: {
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
          artifactType: "PDF",
        },
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Unrelated review.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "cancelled",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: ["full-fiscal-year-run-discarded", "full-fiscal-year-opfs-cleared"],
      },
    });
    expect(JSON.stringify(response)).not.toContain("fullFiscalYearRecovery");
    expect(browser.storage.local.remove).toHaveBeenCalledWith("full-year-ledger");
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
  });

  it("keeps a manually observed full-year target recoverable for ZIP restaging", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({ revision: 2 }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "manually-observed",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: [
          "filed-returns-target-manually-observed",
          "full-fiscal-year-manual-observation-needs-restaging",
        ],
      },
      flowSummary: {
        status: "partial",
        completedPeriods: [],
        fullFiscalYearRecovery: {
          targetStatus: "manually-observed",
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("browser-confirmed");
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        targets: [expect.objectContaining({ status: "manually-observed" })],
      }),
    });
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        completedPeriods: [],
        fullFiscalYearRecovery: expect.objectContaining({
          targetStatus: "manually-observed",
        }),
      }),
    });
  });

  it("resets a manually observed target when the user retries ZIP staging", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "manually-observed",
        safeSignals: [
          "filed-returns-target-manually-observed",
          "full-fiscal-year-manual-observation-needs-restaging",
        ],
      }),
    });

    const recovery = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(recovery).toMatchObject({
      ok: true,
      ledger: {
        status: "running",
        targets: [expect.objectContaining({ status: "pending" })],
      },
    });
  });

  it("retains the saved ledger when discard cannot clear staged files", async () => {
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockResolvedValueOnce([
      "full-fiscal-year-opfs-clear-failed",
      "full-fiscal-year-opfs-clear-error:clear-failed",
    ]);
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "blocked",
        safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
      }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "cancelled",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-run-discard-cleanup-failed",
          "full-fiscal-year-opfs-clear-error:clear-failed",
          "full-fiscal-year-opfs-retained",
        ]),
      },
      flowSummary: {
        fullFiscalYearRecovery: {
          targetStatus: "blocked",
        },
      },
    });
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("full-year-ledger");
  });

  it("retains an interrupted running target when exact discard cleanup fails", async () => {
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockResolvedValueOnce([
      "full-fiscal-year-opfs-clear-failed",
    ]);
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "running",
        safeSignals: ["full-fiscal-year-target-running"],
      }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "cancelled",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-run-discard-cleanup-failed",
          "full-fiscal-year-opfs-retained",
        ]),
      },
      flowSummary: {
        fullFiscalYearRecovery: {
          targetStatus: "running",
        },
      },
    });
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("full-year-ledger");
  });

  it("rejects manual observation when the target has no final-click evidence", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "blocked",
        safeSignals: ["filed-return-result-row-not-found"],
      }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: LEDGER_ID,
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "manually-observed",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["full-fiscal-year-manual-observation-unavailable"],
      },
    });
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.session.set).not.toHaveBeenCalled();
  });

  it("serializes concurrent recovery commands so only one matching revision can mutate", async () => {
    const store: Record<string, unknown> = {
      "full-year-ledger": createRecoveryLedger({ revision: 2 }),
    };
    vi.mocked(browser.storage.local.get).mockImplementation(async (key: unknown) => {
      if (typeof key === "string") return { [key]: store[key] };
      return store;
    });
    vi.mocked(browser.storage.local.set).mockImplementation(
      async (value: Record<string, unknown>) => {
        Object.assign(store, value);
      },
    );

    const payload = {
      ledgerId: LEDGER_ID,
      targetId: "GSTR-3B:2026-27:April",
      expectedRevision: 2,
    };
    const [first, second] = await Promise.all([
      prepareFullFiscalYearTargetRetry(payload, recoveryDeps()),
      prepareFullFiscalYearTargetRetry(payload, recoveryDeps()),
    ]);

    expect(first).toMatchObject({
      ok: true,
      ledger: {
        revision: 3,
        targets: [expect.objectContaining({ status: "pending" })],
      },
    });
    expect(second).toMatchObject({
      ok: false,
      response: {
        flowStep: {
          safeSignals: ["full-fiscal-year-recovery-stale"],
        },
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledTimes(1);
  });
});

function recoveryDeps() {
  return {
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "full-year-ledger",
      targetReview: "target-review",
    },
    now: () => new Date("2026-06-24T00:00:00.000Z"),
  };
}

function mockLocalStorageGet(values: Record<string, unknown>) {
  vi.mocked(browser.storage.local.get).mockImplementation(async (key: unknown) => {
    if (typeof key === "string") return { [key]: values[key] };
    return values;
  });
}

function createHistoricalBlockedFilenameLedger(): FiledReturnsFullFiscalYearLedger {
  const ledger = createRecoveryLedger({
    revision: 2,
    targetStatus: "blocked",
    safeSignals: ["download-filename-overridden"],
  });
  ledger.targets[0]!.safeMessage =
    "Pack paused the saved full-year run at April. Resolve the GST Portal page before retrying this period. Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.";
  return ledger;
}

function createRecoveryLedger({
  revision,
  targetStatus = "download-unconfirmed",
  safeSignals = ["browser-download-size-unknown"],
}: {
  revision: number;
  targetStatus?: FiledReturnsFullFiscalYearLedger["targets"][number]["status"];
  safeSignals?: string[];
}): FiledReturnsFullFiscalYearLedger {
  const scope = {
    financialYear: "2026-27",
    period: "April" as const,
    returnType: "GSTR-3B" as const,
  };
  return {
    schemaVersion: "1.0",
    planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
    ledgerId: LEDGER_ID,
    revision,
    status: targetStatus === "running" ? "running" : "blocked",
    scope: {
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    currentTargetId: "GSTR-3B:2026-27:April",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    eligibleThrough: "April",
    targetPlan: [
      {
        targetId: "GSTR-3B:2026-27:April",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-3B",
      },
    ],
    targets: [
      {
        targetId: "GSTR-3B:2026-27:April",
        ...scope,
        status: targetStatus,
        attempts: 1,
        ...canonicalDurableTargetStatus(scope, targetStatus, safeSignals),
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    ],
  };
}

function createObservingZipLedger(
  financialYear: "2025-26" | "2026-27",
  ledgerId: string,
  downloadId: number,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const scope = {
    artifactType: "PDF" as const,
    financialYear,
    period: FULL_FISCAL_YEAR_PERIOD,
    returnType: "GSTR-3B" as const,
  };
  const base = createFullFiscalYearLedger(
    scope,
    now,
    getFiledReturnsFullFiscalYearPeriods(financialYear, now),
  );
  return {
    ...base,
    ledgerId,
    status: "blocked",
    zipPhase: "download-observing",
    zipDownloadAttempt: { downloadId, requestedAt: now.toISOString() },
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
    })),
  };
}

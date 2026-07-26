import { describe, expect, it } from "vitest";
import {
  FILED_RETURNS_MONTHS,
  FULL_FISCAL_YEAR_PERIOD,
  type FiledReturnsMonth,
} from "../../src/connectors/gst/filed-returns-scope";
import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
  canCompleteFullFiscalYearLedger,
  createFullFiscalYearLedger,
  createFullFiscalYearTargetId,
  hasCanonicalFullFiscalYearTargetPlan,
  isFullFiscalYearLedger,
  markFullFiscalYearTargetRunning,
  markFullFiscalYearTargetTerminal,
  nextRunnableFullFiscalYearTarget,
  reconcileFullFiscalYearLedgerTargets,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { FULL_FISCAL_YEAR_PLAN_VERSION } from "../../src/background/filed-returns-full-fiscal-year-plan";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import {
  summariseFullFiscalYearLedger,
  targetStatusFromFlowStep,
} from "../../src/background/filed-returns-full-fiscal-year";
import { responseForExistingLedger } from "../../src/background/filed-returns-full-fiscal-year-run-state";

describe("full fiscal year ledger", () => {
  it("does not select later targets while an unconfirmed download needs acknowledgement", () => {
    const ledger = createLedger([
      ["April", "download-unconfirmed"],
      ["May", "pending"],
    ]);

    expect(nextRunnableFullFiscalYearTarget(ledger)).toBeNull();
  });

  it("selects only pending targets for normal scheduling", () => {
    expect(nextRunnableFullFiscalYearTarget(createLedger([["April", "pending"]]))).toMatchObject({
      period: "April",
      status: "pending",
    });

    for (const status of ["blocked", "failed", "cancelled"] as const) {
      expect(nextRunnableFullFiscalYearTarget(createLedger([["April", status]]))).toBeNull();
    }
  });

  it("lets an explicitly approved target retry run while other restaging targets stay blocked", () => {
    const ledger = createLedger([
      ["April", "pending"],
      ["May", "blocked"],
    ]);
    ledger.status = "running";
    ledger.currentTargetId = ledger.targets[0]!.targetId;
    ledger.targets[0] = {
      ...ledger.targets[0]!,
      safeSignals: ["full-fiscal-year-target-retry-approved"],
    };

    expect(
      responseForExistingLedger(ledger, new Date("2026-06-24T00:01:00.000Z"), {
        allowExistingLedgerResume: true,
      }),
    ).toBeNull();
    expect(responseForExistingLedger(ledger, new Date("2026-06-24T00:01:00.000Z"))).toMatchObject({
      ok: true,
      flowStep: { state: "blocked" },
    });
  });

  it("preserves durable staged-artifact signals when a target starts running", () => {
    const ledger = createLedger([["April", "pending"]], {
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-2B",
    });
    ledger.targets[0] = {
      ...ledger.targets[0]!,
      safeSignals: [
        "full-fiscal-year-opfs-staged:PDF",
        "filed-return-artifact-downloaded:PDF",
        "portal-system-error",
      ],
    };

    const running = markFullFiscalYearTargetRunning(
      ledger,
      ledger.targets[0]!.targetId,
      new Date("2026-06-24T00:01:00.000Z"),
    );

    expect(running.targets[0]?.safeSignals).toEqual([
      "full-fiscal-year-opfs-staged:PDF",
      "filed-return-artifact-downloaded:PDF",
      "full-fiscal-year-target-running",
    ]);
  });

  it("retains PDF evidence when a combined target retries Excel after restart", () => {
    const initial = createLedger([["April", "pending"]], {
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-2B",
    });
    const targetId = initial.targets[0]!.targetId;
    const pdf = targetDiagnostic("PDF", "action-m0abc123-pdf00001");
    const excel = targetDiagnostic("EXCEL", "action-m0abc123-excel001");
    const afterPdf = markFullFiscalYearTargetTerminal(
      initial,
      targetId,
      "blocked",
      diagnosticStep(pdf, "blocked"),
      new Date("2026-06-24T00:01:00.000Z"),
    );
    const restarted = markFullFiscalYearTargetRunning(
      afterPdf,
      targetId,
      new Date("2026-06-24T00:02:00.000Z"),
    );
    const complete = markFullFiscalYearTargetTerminal(
      restarted,
      targetId,
      "downloaded",
      diagnosticStep(excel, "downloaded"),
      new Date("2026-06-24T00:03:00.000Z"),
    );

    expect(complete.targets[0]).toMatchObject({
      status: "downloaded",
      downloadDiagnostic: excel,
      downloadDiagnostics: [pdf, excel],
    });
    expect(isFullFiscalYearLedger(complete)).toBe(true);
  });

  it("accepts legacy singular diagnostics and rejects malformed combined evidence", () => {
    const pdf = targetDiagnostic("PDF", "action-m0abc123-pdf00001");
    const excel = targetDiagnostic("EXCEL", "action-m0abc123-excel001");
    const legacyLedger = createLedger([["April", "downloaded"]], {
      artifactType: "PDF",
      returnType: "GSTR-2B",
    });
    const legacyTarget = { ...legacyLedger.targets[0]!, downloadDiagnostic: pdf };
    delete legacyTarget.downloadDiagnostics;
    expect(isFullFiscalYearLedger({ ...legacyLedger, targets: [legacyTarget] })).toBe(true);

    const ledger = createLedger([["April", "downloaded"]], {
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-2B",
    });

    const combined = {
      ...ledger,
      targets: [
        {
          ...ledger.targets[0]!,
          downloadDiagnostic: excel,
          downloadDiagnostics: [pdf, excel],
        },
      ],
    };
    expect(isFullFiscalYearLedger(combined)).toBe(true);
    expect(
      isFullFiscalYearLedger({
        ...combined,
        targets: [
          {
            ...combined.targets[0]!,
            downloadDiagnostic: pdf,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...combined,
        targets: [
          {
            ...combined.targets[0]!,
            downloadDiagnostic: { ...excel, actionId: pdf.actionId },
            downloadDiagnostics: [pdf, { ...excel, actionId: pdf.actionId }],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...combined,
        targets: [
          {
            ...combined.targets[0]!,
            downloadDiagnostic: { ...excel, rawUrl: "synthetic-forbidden" },
            downloadDiagnostics: [pdf, { ...excel, rawUrl: "synthetic-forbidden" }],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...combined,
        targets: [
          {
            ...combined.targets[0]!,
            downloadDiagnostic: { ...excel, period: "May" },
            downloadDiagnostics: [pdf, { ...excel, period: "May" }],
          },
        ],
      }),
    ).toBe(false);
  });

  it("summarises saved pending running ledgers as explicit resume confirmation", () => {
    const summary = summariseFullFiscalYearLedger({
      ...createLedger([
        ["April", "downloaded"],
        ["May", "pending"],
      ]),
      status: "running",
      currentTargetId: "GSTR-3B:2026-27:May",
    });

    expect(summary).toMatchObject({
      status: "running",
      currentPeriod: "May",
      fullFiscalYearRecovery: {
        targetId: "GSTR-3B:2026-27:May",
        targetStatus: "pending",
      },
      flowStep: {
        state: "blocked",
        safeSignals: ["full-fiscal-year-resume-confirmation-required"],
      },
    });
    expect(summary.flowStep.safeSignals).not.toContain("full-fiscal-year-run-active");
  });

  it("summarises partial ledgers with pending work as explicit resume confirmation", () => {
    const summary = summariseFullFiscalYearLedger({
      ...createLedger([
        ["April", "downloaded"],
        ["May", "pending"],
      ]),
      status: "partial",
      currentTargetId: "GSTR-3B:2026-27:May",
    });

    expect(summary).toMatchObject({
      status: "partial",
      currentPeriod: "May",
      fullFiscalYearRecovery: {
        targetId: "GSTR-3B:2026-27:May",
        targetStatus: "pending",
      },
      flowStep: {
        state: "blocked",
        safeSignals: ["full-fiscal-year-resume-confirmation-required"],
      },
    });
  });

  it("keeps same-account warning on blocked and cancelled ledgers with pending work", () => {
    for (const status of ["blocked", "cancelled"] as const) {
      const summary = summariseFullFiscalYearLedger({
        ...createLedger([
          ["April", "downloaded"],
          ["May", "pending"],
        ]),
        status,
        currentTargetId: "GSTR-3B:2026-27:May",
      });

      expect(summary.flowStep.safeSignals).toEqual([
        "full-fiscal-year-resume-confirmation-required",
      ]);
      expect(summary.flowStep.safeMessage).toContain("same GST account");
    }
  });

  it("surfaces a blocked target before generic resume confirmation", () => {
    const ledger = createLedger([
      ["April", "blocked"],
      ["May", "pending"],
    ]);
    const summary = summariseFullFiscalYearLedger({
      ...ledger,
      targets: ledger.targets.map((target) =>
        target.period === "April"
          ? {
              ...target,
              safeSignals: ["portal-system-error"],
              safeMessage: "The GST portal returned a system-error page.",
            }
          : target,
      ),
      status: "blocked",
      currentTargetId: "GSTR-3B:2026-27:April",
    });

    expect(summary).toMatchObject({
      status: "blocked",
      currentPeriod: "April",
      fullFiscalYearRecovery: {
        targetId: "GSTR-3B:2026-27:April",
        targetStatus: "blocked",
      },
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-run-needs-action",
          "portal-system-error",
        ]),
        safeMessage: "The GST portal returned a system-error page.",
      },
    });
  });

  it("maps only positive not-filed evidence to a terminal not-filed target", () => {
    expect(
      targetStatusFromFlowStep({
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "candidate-not-found",
        safeSignals: ["filed-return-positively-not-filed"],
        safeMessage: "No filed return exists for the selected period.",
      }),
    ).toBe("not-filed");

    expect(
      targetStatusFromFlowStep({
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "candidate-not-found",
        safeSignals: ["filed-return-result-row-not-found"],
        safeMessage: "Missing result row.",
      }),
    ).toBe("blocked");
  });

  it.each([
    "browser-download-not-observed",
    "browser-download-size-unknown",
    "browser-download-interrupted",
    "browser-download-correlation-rejected",
    "browser-download-search-unavailable",
    "browser-download-search-missing",
    "browser-download-zero-bytes",
    "filed-return-download-trigger-ambiguous",
    "filed-gstr3b-download-trigger-ambiguous",
  ])("maps unresolved browser evidence %s to an unconfirmed target", (signal) => {
    expect(
      targetStatusFromFlowStep({
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "blocked",
        safeSignals: [signal],
        safeMessage: "Pack could not prove the download completed.",
      }),
    ).toBe("download-unconfirmed");
  });

  it("requires the exact canonical current-year prefix before completion", () => {
    const planned = markEveryTargetDownloaded(
      createFullFiscalYearLedger(
        {
          artifactType: "PDF",
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        new Date("2026-07-24T00:00:00.000Z"),
        ["April", "May", "June"],
      ),
    );

    expect(hasCanonicalFullFiscalYearTargetPlan(planned)).toBe(true);
    expect(canCompleteFullFiscalYearLedger(planned)).toBe(true);
    expect(isFullFiscalYearLedger(planned)).toBe(true);
    expect(
      isFullFiscalYearLedger({
        ...planned,
        eligibleThrough: "June",
        targets: planned.targets.slice(0, 2),
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...planned,
        targets: [planned.targets[1], planned.targets[0], planned.targets[2]],
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...planned,
        eligibleThrough: "May",
      }),
    ).toBe(false);
  });

  it("refuses to create a ledger from a noncanonical target list", () => {
    expect(() =>
      createFullFiscalYearLedger(
        {
          artifactType: "PDF",
          financialYear: "2026-27",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        new Date("2026-07-24T00:00:00.000Z"),
        ["May"],
      ),
    ).toThrow("Invalid full-fiscal-year target plan.");
  });

  it("accepts the exact 12-month plan for a past fiscal year", () => {
    const planned = markEveryTargetDownloaded(
      createFullFiscalYearLedger(
        {
          artifactType: "PDF",
          financialYear: "2024-25",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        new Date("2026-07-24T00:00:00.000Z"),
        FILED_RETURNS_MONTHS,
      ),
    );

    expect(planned.targets).toHaveLength(12);
    expect(planned.eligibleThrough).toBe("March");
    expect(canCompleteFullFiscalYearLedger(planned)).toBe(true);
    expect(isFullFiscalYearLedger(planned)).toBe(true);
  });

  it("normalises only a canonical legacy non-ZIP prefix and blocks legacy completion", () => {
    const planned = createLedger([
      ["April", "downloaded"],
      ["May", "pending"],
    ]);
    const legacy = { ...planned };
    delete legacy.eligibleThrough;
    delete legacy.planVersion;

    expect(isFullFiscalYearLedger(legacy)).toBe(true);
    const reconciled = reconcileFullFiscalYearLedgerTargets(
      legacy,
      new Date("2026-07-24T00:00:00.000Z"),
      ["April", "May", "June"],
    );
    expect(reconciled).toMatchObject({
      planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
      eligibleThrough: "June",
      status: "running",
      targets: [{ period: "April" }, { period: "May" }, { period: "June", status: "pending" }],
    });
    expect(hasCanonicalFullFiscalYearTargetPlan(reconciled)).toBe(true);
    expect(isFullFiscalYearLedger({ ...legacy, status: "complete" })).toBe(false);
    expect(
      isFullFiscalYearLedger({ ...legacy, status: "blocked", zipPhase: "export-pending" }),
    ).toBe(false);
  });

  it("expands a stale final plan before action and never shrinks a persisted plan", () => {
    const completedApril = markEveryTargetDownloaded(createLedger([["April", "downloaded"]]));
    const staleFinal: FiledReturnsFullFiscalYearLedger = {
      ...completedApril,
      status: "blocked",
      zipPhase: "downloaded-cleanup-pending",
    };
    const expanded = reconcileFullFiscalYearLedgerTargets(
      staleFinal,
      new Date("2026-07-24T00:00:00.000Z"),
      ["April", "May", "June"],
    );

    expect(expanded).toMatchObject({
      eligibleThrough: "June",
      status: "running",
      targets: [
        { period: "April", status: "downloaded" },
        { period: "May", status: "pending" },
        { period: "June", status: "pending" },
      ],
    });
    expect(expanded.zipPhase).toBeUndefined();
    const notShrunk = reconcileFullFiscalYearLedgerTargets(
      expanded,
      new Date("2026-05-24T00:00:00.000Z"),
      ["April"],
    );
    expect(notShrunk.targets.map((target) => target.period)).toEqual(["April", "May", "June"]);
    expect(notShrunk.eligibleThrough).toBe("June");
  });

  it("rejects malformed or inconsistent persisted ledgers", () => {
    expect(isFullFiscalYearLedger(createLedger([["April", "downloaded"]]))).toBe(true);

    const downloadedWithoutEvidence = createLedger([["April", "downloaded"]]);
    delete downloadedWithoutEvidence.targets[0]!.downloadDiagnostic;
    delete downloadedWithoutEvidence.targets[0]!.downloadDiagnostics;
    expect(isFullFiscalYearLedger(downloadedWithoutEvidence)).toBe(false);

    const notFiledWithoutPositiveSignal = createLedger([["April", "not-filed"]]);
    notFiledWithoutPositiveSignal.targets[0]!.safeSignals = [];
    expect(isFullFiscalYearLedger(notFiledWithoutPositiveSignal)).toBe(false);

    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        connectorVersion: "0.4.0-synthetic-label",
      }),
    ).toBe(false);

    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "surprise",
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        targets: [
          { ...createTarget("April", "downloaded") },
          { ...createTarget("April", "pending") },
        ],
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        targets: [{ ...createTarget("April", "downloaded"), financialYear: "2025-26" }],
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        targets: [{ ...createTarget("April", "downloaded"), status: "unknown" }],
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "blocked",
        zipPhase: "download-started",
      }),
    ).toBe(true);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "pending"]]),
        status: "blocked",
        zipPhase: "download-observing",
        zipDownloadAttempt: {
          requestedAt: "2026-06-24T00:00:30.000Z",
          downloadId: 81,
        },
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        ledgerId: "unsafe/ledger-id",
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        rawUrl: "synthetic-forbidden-url",
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        scope: {
          ...createLedger([["April", "downloaded"]]).scope,
          financialYear: "2026-99",
        },
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "blocked",
        zipPhase: "download-intent-persisted",
        zipDownloadAttempt: { requestedAt: "2026-06-24T00:00:30.000Z" },
      }),
    ).toBe(true);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "blocked",
        zipPhase: "download-observing",
        zipDownloadAttempt: {
          requestedAt: "2026-06-24T00:00:30.000Z",
          downloadId: 81,
        },
      }),
    ).toBe(true);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "blocked",
        zipPhase: "download-observing",
        zipDownloadAttempt: { requestedAt: "2026-06-24T00:00:30.000Z" },
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "blocked",
        zipPhase: "download-intent-persisted",
        zipDownloadAttempt: {
          requestedAt: "2026-06-24T00:00:30.000Z",
          downloadId: 81,
        },
      }),
    ).toBe(false);
    for (const zipDownloadAttempt of [
      { requestedAt: "not-a-timestamp" },
      { requestedAt: "2026" },
      { requestedAt: "2026-06-24T00:00:30.000Z", downloadId: -1 },
      { requestedAt: "2026-06-24T00:00:30.000Z", downloadId: 1.5 },
      {
        requestedAt: "2026-06-24T00:00:30.000Z",
        downloadId: Number.MAX_SAFE_INTEGER + 1,
      },
      { requestedAt: "2026-06-24T00:00:30.000Z", downloadId: "81" },
      { requestedAt: "2026-06-24T00:00:30.000Z", rawUrl: "https://example.invalid/private" },
    ]) {
      expect(
        isFullFiscalYearLedger({
          ...createLedger([["April", "downloaded"]]),
          status: "blocked",
          zipPhase: "download-observing",
          zipDownloadAttempt,
        }),
      ).toBe(false);
    }
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "blocked",
        zipPhase: "export-retry-pending",
        zipDownloadAttempt: { requestedAt: "2026-06-24T00:00:30.000Z" },
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "blocked",
        zipPhase: "downloaded-cleanup-pending",
      }),
    ).toBe(true);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        status: "complete",
        zipPhase: "downloaded-cleanup-pending",
      }),
    ).toBe(false);
    expect(
      isFullFiscalYearLedger({
        ...createLedger([["April", "downloaded"]]),
        zipPhase: "unknown",
      }),
    ).toBe(false);
  });

  it("keeps validation pure and rejects non-canonical or unknown durable status", () => {
    const ledger = createLedger([["April", "downloaded"]]);
    const unsafe = structuredClone(ledger);
    unsafe.targets[0]!.safeMessage = "GSTIN 00XXXXX0000X0Z0 belongs to Synthetic Taxpayer";
    const before = structuredClone(unsafe);

    expect(isFullFiscalYearLedger(unsafe)).toBe(false);
    expect(unsafe).toEqual(before);

    const unknownSignal = structuredClone(ledger);
    unknownSignal.targets[0]!.safeSignals = ["synthetic-portal-option-value"];
    expect(isFullFiscalYearLedger(unknownSignal)).toBe(false);
  });

  it("blocks an unknown terminal signal instead of completing the target", () => {
    const ledger = createLedger([["April", "pending"]]);
    const targetId = ledger.targets[0]!.targetId;
    const blocked = markFullFiscalYearTargetTerminal(
      ledger,
      targetId,
      "downloaded",
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["synthetic-taxpayer-status"],
        safeMessage: "Synthetic Taxpayer 00XXXXX0000X0Z0 downloaded.",
      },
      new Date("2026-06-24T00:01:00.000Z"),
    );

    expect(blocked.status).toBe("blocked");
    expect(blocked.targets[0]).toMatchObject({
      status: "blocked",
      safeSignals: ["filed-return-durable-status-rejected"],
    });
    expect(canCompleteFullFiscalYearLedger(blocked)).toBe(false);
  });

  it("validates GSTR-1 full fiscal year ledgers with artifact-specific targets", () => {
    const ledger = createLedger(
      [
        ["April", "downloaded"],
        ["May", "downloaded"],
      ],
      {
        artifactType: "PDF_AND_EXCEL",
        returnType: "GSTR-1",
      },
    );

    expect(ledger.scope).toMatchObject({
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-1",
    });
    expect(ledger.targets[1]).toMatchObject({
      artifactType: "PDF_AND_EXCEL",
      targetId: "GSTR-1:2026-27:May:PDF_AND_EXCEL",
      returnType: "GSTR-1",
    });
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    expect(createFullFiscalYearTargetId("2026-27", "May", "GSTR-1", "PDF_AND_EXCEL")).toBe(
      "GSTR-1:2026-27:May:PDF_AND_EXCEL",
    );

    expect(
      isFullFiscalYearLedger({
        ...ledger,
        targets: ledger.targets.map((target) =>
          target.period === "May" ? { ...target, artifactType: "PDF" } : target,
        ),
      }),
    ).toBe(false);
  });
});

function createLedger(
  targets: Array<
    [FiledReturnsMonth, FiledReturnsFullFiscalYearLedger["targets"][number]["status"]]
  >,
  options: {
    artifactType?: FiledReturnsFullFiscalYearLedger["scope"]["artifactType"];
    returnType?: FiledReturnsFullFiscalYearLedger["scope"]["returnType"];
  } = {},
): FiledReturnsFullFiscalYearLedger {
  const now = "2026-06-24T00:00:00.000Z";
  const returnType = options.returnType ?? "GSTR-3B";
  const artifactType = options.artifactType ?? "PDF";
  const hasCanonicalTargetPrefix = targets.every(
    ([period], index) => period === FILED_RETURNS_MONTHS[index],
  );
  const eligibleThrough = hasCanonicalTargetPrefix ? targets.at(-1)?.[0] : undefined;
  return {
    schemaVersion: "1.0",
    ...(eligibleThrough
      ? {
          planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
          eligibleThrough,
        }
      : {}),
    ledgerId: "11111111111111111111",
    status: "blocked",
    scope: {
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType,
      artifactType,
    },
    ...(targets[0]
      ? {
          currentTargetId: createFullFiscalYearTargetId(
            "2026-27",
            targets[0][0],
            returnType,
            artifactType,
          ),
        }
      : {}),
    createdAt: now,
    updatedAt: now,
    targets: targets.map(([period, status]) =>
      createTarget(period, status, { artifactType, returnType }),
    ),
  };
}

function createTarget(
  period: FiledReturnsMonth,
  status: FiledReturnsFullFiscalYearLedger["targets"][number]["status"],
  options: {
    artifactType?: FiledReturnsFullFiscalYearLedger["targets"][number]["artifactType"];
    returnType?: FiledReturnsFullFiscalYearLedger["targets"][number]["returnType"];
  } = {},
): FiledReturnsFullFiscalYearLedger["targets"][number] {
  const now = "2026-06-24T00:00:00.000Z";
  const returnType = options.returnType ?? "GSTR-3B";
  const artifactType = options.artifactType ?? "PDF";
  const scope = {
    artifactType,
    financialYear: "2026-27",
    period,
    returnType,
  };
  const downloadedEvidence =
    status === "downloaded"
      ? positiveTargetEvidence("2026-27", period, returnType, artifactType)
      : undefined;
  return {
    targetId: createFullFiscalYearTargetId("2026-27", period, returnType, artifactType),
    financialYear: "2026-27",
    period,
    returnType,
    artifactType,
    status,
    attempts: status === "pending" ? 0 : 1,
    ...canonicalDurableTargetStatus(
      scope,
      status,
      downloadedEvidence?.safeSignals ??
        (status === "not-filed" ? ["filed-return-positively-not-filed"] : []),
    ),
    ...(downloadedEvidence?.diagnosticState ?? {}),
    updatedAt: now,
  };
}

function markEveryTargetDownloaded(
  ledger: FiledReturnsFullFiscalYearLedger,
): FiledReturnsFullFiscalYearLedger {
  return {
    ...ledger,
    status: "complete",
    targets: ledger.targets.map((target) => {
      const evidence = positiveTargetEvidence(
        target.financialYear,
        target.period as FiledReturnsMonth,
        target.returnType,
        target.artifactType ?? "PDF",
      );
      return {
        ...target,
        status: "downloaded" as const,
        attempts: Math.max(1, target.attempts),
        ...canonicalDurableTargetStatus(
          {
            financialYear: target.financialYear,
            period: target.period,
            returnType: target.returnType,
            ...(target.artifactType ? { artifactType: target.artifactType } : {}),
          },
          "downloaded",
          evidence.safeSignals,
        ),
        ...evidence.diagnosticState,
      };
    }),
  };
}

function positiveTargetEvidence(
  financialYear: string,
  period: FiledReturnsMonth,
  returnType: FiledReturnsFullFiscalYearLedger["scope"]["returnType"],
  artifactType: NonNullable<FiledReturnsFullFiscalYearLedger["scope"]["artifactType"]>,
) {
  const artifactTypes: Array<"PDF" | "JSON" | "EXCEL"> =
    artifactType === "PDF_AND_EXCEL" ? (["PDF", "EXCEL"] as const) : [artifactType];
  const diagnostics = artifactTypes.map((concreteArtifactType, index) => {
    const periodIndex = FILED_RETURNS_MONTHS.indexOf(period);
    const actionIndex = periodIndex * 2 + index + 1;
    return {
      schemaVersion: "1.0" as const,
      eventType: "filed-return-download-path" as const,
      actionId: `00000000-0000-4000-8000-${String(actionIndex).padStart(12, "0")}`,
      returnType,
      financialYear,
      period,
      endpointClass:
        returnType === "GSTR-3B"
          ? ("gstr3b-portal-blob-captured-download" as const)
          : returnType === "GSTR-2B"
            ? ("gstr2b-portal-blob-captured-download" as const)
            : concreteArtifactType === "PDF"
              ? ("gstr1-pdf-portal-blob-captured-download" as const)
              : ("gstr1-excel-portal-blob-captured-download" as const),
      artifactType: concreteArtifactType,
      downloadPathClass: "captured-portal-request-data" as const,
      status: "downloaded" as const,
      mimeClass: concreteArtifactType === "PDF" ? ("pdf" as const) : ("spreadsheet" as const),
      byteCountClass: "non-empty" as const,
    } satisfies FiledReturnsDownloadDiagnostic;
  });
  const diagnosticState =
    diagnostics.length === 1
      ? { downloadDiagnostic: diagnostics[0]! }
      : {
          downloadDiagnostic: diagnostics.at(-1)!,
          downloadDiagnostics: diagnostics,
        };
  return {
    safeSignals: artifactTypes.flatMap((concreteArtifactType) => [
      `filed-return-artifact-downloaded:${concreteArtifactType}`,
      `full-fiscal-year-opfs-staged:${concreteArtifactType}`,
    ]),
    diagnosticState,
  };
}

function targetDiagnostic(
  artifactType: "PDF" | "EXCEL",
  actionId: string,
): FiledReturnsDownloadDiagnostic {
  return {
    schemaVersion: "1.0",
    eventType: "filed-return-download-path",
    actionId,
    returnType: "GSTR-2B",
    financialYear: "2026-27",
    period: "April",
    endpointClass: "gstr2b-portal-blob-captured-download",
    artifactType,
    downloadPathClass: "captured-portal-request-blob",
    downloadId: artifactType === "PDF" ? 41 : 42,
    status: "downloaded",
    mimeClass: artifactType === "PDF" ? "pdf" : "spreadsheet",
    byteCountClass: "non-empty",
  };
}

function diagnosticStep(
  downloadDiagnostic: FiledReturnsDownloadDiagnostic,
  state: "blocked" | "downloaded",
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-gstr2b-private-v0",
    state,
    safeSignals: [`filed-return-artifact-downloaded:${downloadDiagnostic.artifactType}`],
    safeMessage: "Synthetic target diagnostic.",
    downloadDiagnostic,
  };
}

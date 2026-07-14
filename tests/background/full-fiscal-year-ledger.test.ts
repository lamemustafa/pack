import { describe, expect, it } from "vitest";
import {
  FULL_FISCAL_YEAR_PERIOD,
  type FiledReturnsMonth,
} from "../../src/core/filed-returns-scope";
import type { FiledReturnsFullFiscalYearLedger } from "../../src/core/contracts";
import {
  createFullFiscalYearTargetId,
  isFullFiscalYearLedger,
  nextRunnableFullFiscalYearTarget,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import {
  summariseFullFiscalYearLedger,
  targetStatusFromFlowStep,
} from "../../src/background/filed-returns-full-fiscal-year";

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

  it("rejects malformed or inconsistent persisted ledgers", () => {
    expect(isFullFiscalYearLedger(createLedger([["April", "downloaded"]]))).toBe(true);

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

  it("validates GSTR-1 full fiscal year ledgers with artifact-specific targets", () => {
    const ledger = createLedger([["May", "downloaded"]], {
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-1",
    });

    expect(ledger.scope).toMatchObject({
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-1",
    });
    expect(ledger.targets[0]).toMatchObject({
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
        targets: [{ ...ledger.targets[0], artifactType: "PDF" }],
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
  return {
    schemaVersion: "1.0",
    ledgerId: "ledger-test",
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
  return {
    targetId: createFullFiscalYearTargetId("2026-27", period, returnType, artifactType),
    financialYear: "2026-27",
    period,
    returnType,
    artifactType,
    status,
    attempts: status === "pending" ? 0 : 1,
    safeSignals: [],
    safeMessage: `${period} ${status}`,
    updatedAt: now,
  };
}

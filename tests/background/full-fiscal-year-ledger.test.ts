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
import { concreteFiledReturnsArtifactTypesForSelection } from "../../src/connectors/gst/filed-returns-artifacts";
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
  resumeFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { FULL_FISCAL_YEAR_PLAN_VERSION } from "../../src/background/filed-returns-full-fiscal-year-validation";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import {
  summariseFullFiscalYearLedger,
  targetStatusFromFlowStep,
} from "../../src/background/filed-returns-full-fiscal-year";
import { completeFullFiscalYearStep } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { responseForExistingLedger } from "../../src/background/filed-returns-full-fiscal-year-run-state";
import {
  requireFullFiscalYearArtifactsStaged,
  scopeForFullFiscalYearTarget,
} from "../../src/background/filed-returns-full-fiscal-year-staging";

describe("full fiscal year ledger", () => {
  it("requires the canonical GSTR-2B all-formats artifact set before staging succeeds", () => {
    const expectedArtifacts = concreteFiledReturnsArtifactTypesForSelection(
      "GSTR-2B",
      "PDF_AND_EXCEL",
    );
    const result = requireFullFiscalYearArtifactsStaged(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-2B",
      },
      {
        connectorId: "gst",
        scopeId: "synthetic-gstr2b-all-formats",
        state: "downloaded",
        safeMessage: "Synthetic artifacts staged.",
        safeSignals: expectedArtifacts
          .slice(0, -1)
          .map((artifactType) => `full-fiscal-year-opfs-staged:${artifactType}`),
      },
    );

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(
        expectedArtifacts
          .slice(-1)
          .map((artifactType) => `full-fiscal-year-artifact-not-staged:${artifactType}`),
      ),
    );
  });

  it("keeps a fresh all-formats target intact for its first fiscal-year attempt", () => {
    const ledger = createLedger([["April", "pending"]], {
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-1",
    });

    expect(scopeForFullFiscalYearTarget(ledger.targets[0]!)).toMatchObject({
      artifactType: "PDF_AND_EXCEL",
      period: "April",
      returnType: "GSTR-1",
    });
  });

  it("retries only the missing all-formats artifact after a prior stage", () => {
    const ledger = createLedger([["April", "blocked"]], {
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-1",
    });
    ledger.targets[0] = {
      ...ledger.targets[0]!,
      safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
    };

    expect(scopeForFullFiscalYearTarget(ledger.targets[0]!)).toMatchObject({
      artifactType: "EXCEL",
      period: "April",
      returnType: "GSTR-1",
    });
  });

  it("retains the canonical GSTR-2B selection while multiple artifacts remain", () => {
    const ledger = createLedger([["April", "blocked"]], {
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-2B",
    });
    ledger.targets[0] = {
      ...ledger.targets[0]!,
      safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
    };

    expect(scopeForFullFiscalYearTarget(ledger.targets[0]!)).toMatchObject({
      artifactType: "PDF_AND_EXCEL",
      period: "April",
      returnType: "GSTR-2B",
    });
  });

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

  it("retains component evidence across an all-formats target recovery", () => {
    const initial = createLedger([["April", "pending"]], {
      artifactType: "PDF_AND_EXCEL",
      returnType: "GSTR-2B",
    });
    const targetId = initial.targets[0]!.targetId;
    const pdf = targetDiagnostic("PDF", "action-m0abc123-pdf00001");
    const excel = targetDiagnostic("EXCEL", "action-m0abc123-excel001");
    const json = targetDiagnostic("JSON", "action-m0abc123-json0001");
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
    const afterExcel = markFullFiscalYearTargetTerminal(
      restarted,
      targetId,
      "blocked",
      diagnosticStep(excel, "blocked"),
      new Date("2026-06-24T00:03:00.000Z"),
    );
    const complete = markFullFiscalYearTargetTerminal(
      markFullFiscalYearTargetRunning(afterExcel, targetId, new Date("2026-06-24T00:04:00.000Z")),
      targetId,
      "downloaded",
      diagnosticStep(json, "downloaded"),
      new Date("2026-06-24T00:05:00.000Z"),
    );

    expect(complete.targets[0]).toMatchObject({
      status: "downloaded",
      downloadDiagnostic: json,
      downloadDiagnostics: [pdf, excel, json],
    });
    expect(isFullFiscalYearLedger(complete)).toBe(true);
  });

  it("accepts legacy singular diagnostics and rejects malformed combined evidence", () => {
    const pdf = targetDiagnostic("PDF", "action-m0abc123-pdf00001");
    const excel = targetDiagnostic("EXCEL", "action-m0abc123-excel001");
    const json = targetDiagnostic("JSON", "action-m0abc123-json0001");
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
          downloadDiagnostic: json,
          downloadDiagnostics: [pdf, excel, json],
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
            downloadDiagnostics: [pdf, excel, { ...json, actionId: pdf.actionId }],
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
            downloadDiagnostic: { ...json, rawUrl: "synthetic-forbidden" },
            downloadDiagnostics: [pdf, excel, { ...json, rawUrl: "synthetic-forbidden" }],
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
            downloadDiagnostic: { ...json, period: "May" },
            downloadDiagnostics: [pdf, excel, { ...json, period: "May" }],
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

  it("self-heals an old stored download-review message for a blocked portal system error", () => {
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
              safeMessage:
                "Pack could not verify the browser download for April. Check Downloads before retrying or cancelling this target.",
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
        safeMessage:
          "The GST portal returned a system-error page. Return to an authenticated GST page and retry this period.",
      },
    });
    expect(summary.flowStep.safeMessage.toLowerCase()).not.toContain("download");
  });

  it.each([
    [
      "portal-scheduled-downtime",
      "The GST portal is in scheduled downtime. Wait until GST services are available, then reopen Pack and retry.",
    ],
    [
      "portal-blocked-or-session-expired",
      "The GST portal appears to be on an access-denied or expired-session screen. Please return to an authenticated GST page before using Pack.",
    ],
  ])("renders the durable %s cause without a download warning", (signal, expectedMessage) => {
    const ledger = createLedger([["April", "blocked"]]);
    const summary = summariseFullFiscalYearLedger({
      ...ledger,
      currentTargetId: ledger.targets[0]!.targetId,
      status: "blocked",
      targets: ledger.targets.map((target) => ({
        ...target,
        safeMessage: "The old stored review message is stale.",
        safeSignals: [signal],
      })),
    });

    expect(summary.flowStep.safeMessage).toBe(expectedMessage);
    expect(summary.flowStep.safeMessage.toLowerCase()).not.toContain("download");
  });

  it("renders generic blocked and Pack-side failed targets as distinct non-download causes", () => {
    const blockedLedger = createLedger([["April", "blocked"]]);
    const failedLedger = createLedger([["April", "failed"]]);
    const blocked = summariseFullFiscalYearLedger({
      ...blockedLedger,
      currentTargetId: blockedLedger.targets[0]!.targetId,
      status: "blocked",
      targets: blockedLedger.targets.map((target) => ({
        ...target,
        safeMessage: "The old stored review message is stale.",
      })),
    });
    const failed = summariseFullFiscalYearLedger({
      ...failedLedger,
      currentTargetId: failedLedger.targets[0]!.targetId,
      status: "blocked",
      targets: failedLedger.targets.map((target) => ({
        ...target,
        safeMessage: "The old stored review message is stale.",
      })),
    });

    expect(blocked.flowStep.safeMessage).toContain("paused the saved full-year run");
    expect(failed.flowStep.safeMessage).toContain("Pack stopped while processing April.");
    expect(failed.flowStep.safeMessage).not.toBe(blocked.flowStep.safeMessage);
    expect(
      `${blocked.flowStep.safeMessage} ${failed.flowStep.safeMessage}`.toLowerCase(),
    ).not.toContain("download");
  });

  it("keeps download verification fail-closed when a download-unconfirmed target also carries a portal cause", () => {
    const durable = canonicalDurableTargetStatus(
      { financialYear: "2026-27", period: "April", returnType: "GSTR-3B" },
      "download-unconfirmed",
      ["portal-system-error"],
    );

    expect(durable.safeMessage).toContain("verify the browser download");
  });

  it.each([
    [
      "download-filename-unavailable",
      "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
    ],
    [
      "zip-download-filename-item-unavailable",
      "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
    ],
    [
      "zip-download-filename-search-unavailable",
      "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
    ],
    [
      "zip-download-filename-unavailable",
      "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
    ],
    [
      "download-filename-overridden",
      "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
    ],
    [
      "zip-download-filename-overridden",
      "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
    ],
  ])("retains filename outcome %s in canonical target copy", (signal, warning) => {
    const durable = canonicalDurableTargetStatus(
      { financialYear: "2026-27", period: "April", returnType: "GSTR-3B" },
      "downloaded",
      ["browser-download-completed", "browser-download-non-empty", signal],
    );

    expect(durable.safeMessage).toBe(
      `Pack confirmed the filed-return download for April. ${warning}`,
    );
  });

  it.each([
    [
      "download-filename-overridden",
      "The browser may have used a different saved name, but Pack could not verify that any file belongs to this unresolved target. Check browser Downloads before using a file.",
    ],
    [
      "download-filename-unavailable",
      "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
    ],
    [
      "zip-download-filename-overridden",
      "The browser may have used a different saved name, but Pack could not verify that any file belongs to this unresolved target. Check browser Downloads before using a file.",
    ],
    [
      "zip-download-filename-unavailable",
      "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
    ],
    [
      "zip-download-filename-item-unavailable",
      "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
    ],
    [
      "zip-download-filename-search-unavailable",
      "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
    ],
  ])("keeps target-review filename outcome %s neutral", (signal, warning) => {
    const durable = canonicalDurableTargetStatus(
      { financialYear: "2026-27", period: "April", returnType: "GSTR-3B" },
      "target-review",
      ["portal-system-error", signal],
    );

    expect(durable.safeMessage).toBe(
      `Pack could not verify the browser download for April. Check Downloads before retrying or cancelling this target. ${warning}`,
    );
    expect(durable.safeMessage).not.toContain("Pack completed the download");
  });

  it.each(["downloaded", "target-review"] as const)(
    "keeps filename override precedence for %s copy",
    (status) => {
      const scope = { financialYear: "2026-27", period: "April", returnType: "GSTR-3B" } as const;
      const overridden = canonicalDurableTargetStatus(scope, status, [
        "zip-download-filename-overridden",
      ]);
      const mixed = canonicalDurableTargetStatus(scope, status, [
        "download-filename-unavailable",
        "zip-download-filename-overridden",
      ]);

      expect(mixed.safeMessage).toBe(overridden.safeMessage);
    },
  );

  it.each([
    "filed-return-download-target-mismatch",
    "filed-gstr3b-direct-download-action-mismatch",
    "filed-gstr3b-direct-download-start-rejected",
    "filed-gstr3b-direct-download-target-rejected",
    "filed-return-download-diagnostics-rejected",
  ])("keeps target-review filename copy neutral with %s", (contradiction) => {
    const durable = canonicalDurableTargetStatus(
      { financialYear: "2026-27", period: "April", returnType: "GSTR-3B" },
      "target-review",
      [
        "browser-download-completed",
        "browser-download-id:81",
        "browser-download-non-empty",
        "download-filename-overridden",
        contradiction,
      ],
    );

    expect(durable.safeMessage).toBe(
      "Pack could not verify the browser download for April. Check Downloads before retrying or cancelling this target. The browser may have used a different saved name, but Pack could not verify that any file belongs to this unresolved target. Check browser Downloads before using a file.",
    );
    expect(durable.safeMessage).not.toContain("Pack completed the download");
    expect(durable.safeMessage).not.toContain("Pack recorded a different saved name");
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

  it("requires the exact recorded target plan before completion", () => {
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
        targetPlan: planned.targetPlan?.slice(0, 2),
      }),
    ).toBe(false);
    expect(isFullFiscalYearLedger({ ...planned, eligibleThrough: "May" })).toBe(true);
  });

  it("recovers an incomplete legacy target prefix but never treats it as complete", () => {
    const planned = createLedger([["April", "blocked"]]);
    const legacy = { ...planned };
    delete legacy.planVersion;
    delete legacy.eligibleThrough;
    delete legacy.targetPlan;

    expect(isFullFiscalYearLedger(legacy)).toBe(true);
    expect(isFullFiscalYearLedger({ ...legacy, status: "complete" })).toBe(false);
    expect(isFullFiscalYearLedger({ ...legacy, zipPhase: "export-pending" })).toBe(false);
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

  it("states how far short of the year a fixed plan now falls", () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    // Created in June, when April and May were the whole eligible year.
    const planned = createFullFiscalYearLedger(scope, new Date("2026-06-24T00:00:00.000Z"), [
      "April",
      "May",
    ]);
    const complete = { ...planned, status: "complete" as const };

    // Finished the same day it was planned: the plan is the year, so the
    // completion message must not invent a shortfall.
    const sameDay = completeFullFiscalYearStep(complete, new Date("2026-06-24T00:00:00.000Z"));
    expect(sameDay.safeSignals).not.toContain("full-fiscal-year-plan-narrower-than-eligible");
    expect(sameDay.safeMessage).toBe(
      "Pack completed the local full fiscal year run for FY 2026-27.",
    );

    // Resumed and finished in September, by which time June, July and August
    // have become eligible. The plan does not grow, so the outcome has to say so
    // where the outcome is stated.
    const later = completeFullFiscalYearStep(complete, new Date("2026-09-24T00:00:00.000Z"));
    expect(later.safeSignals).toContain("full-fiscal-year-plan-narrower-than-eligible");
    expect(later.safeMessage).toContain("covers the 2 periods planned when it started");
    expect(later.safeMessage).toContain("3 more are eligible now, starting with June");
    expect(later.safeMessage).toContain("Start this year again to include them");
  });

  it("claims no shortfall for a past year whose plan is the whole year", () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2025-26",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const planned = createFullFiscalYearLedger(
      scope,
      new Date("2026-09-24T00:00:00.000Z"),
      FILED_RETURNS_MONTHS,
    );
    expect(planned.targets).toHaveLength(12);

    const step = completeFullFiscalYearStep(
      { ...planned, status: "complete" },
      new Date("2026-09-24T00:00:00.000Z"),
    );

    expect(step.safeSignals).not.toContain("full-fiscal-year-plan-narrower-than-eligible");
    expect(step.safeMessage).toBe("Pack completed the local full fiscal year run for FY 2025-26.");
  });

  it("retains the recorded plan unchanged when a plan resumes", () => {
    const ledger = createLedger([["April", "running"]]);
    const resumed = resumeFullFiscalYearLedger(ledger, new Date("2026-06-24T01:00:00.000Z"));

    expect(resumed.targetPlan).toEqual(ledger.targetPlan);
    expect(resumed.targets[0]?.status).toBe("pending");
  });

  it("never expands or shrinks a persisted target plan", () => {
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
      eligibleThrough: "April",
      status: "blocked",
      targets: [{ period: "April", status: "downloaded" }],
    });
    expect(expanded.targetPlan).toEqual(completedApril.targetPlan);
    expect(expanded.zipPhase).toBe("downloaded-cleanup-pending");
    const notShrunk = reconcileFullFiscalYearLedgerTargets(
      expanded,
      new Date("2026-05-24T00:00:00.000Z"),
      ["April"],
    );
    expect(notShrunk.targets.map((target) => target.period)).toEqual(["April"]);
    expect(notShrunk.eligibleThrough).toBe("April");
  });

  it("completes only when the targets still match the recorded plan in order", () => {
    // The plan is the authority a run answers to, so target order is part of the
    // record, not an incidental array. A reordered target list is a different
    // record and must not satisfy completion.
    const planned = createLedger([
      ["April", "not-filed"],
      ["May", "not-filed"],
    ]);

    expect(isFullFiscalYearLedger(planned)).toBe(true);
    expect(canCompleteFullFiscalYearLedger(planned)).toBe(true);
    expect(
      canCompleteFullFiscalYearLedger({ ...planned, targets: [...planned.targets].reverse() }),
    ).toBe(false);
  });

  it("rejects a target that does not belong to its ledger's scope", () => {
    // A plan record is filed under one returnType:financialYear:artifactType, so
    // a target from a different one could never have been stored under it.
    const planned = createLedger([["April", "not-filed"]]);
    const foreign = { ...planned.targets[0]!, financialYear: "2025-26" };

    expect(isFullFiscalYearLedger({ ...planned, targets: [foreign] })).toBe(false);
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
      safeSignals: [
        "filed-return-durable-status-rejected",
        "filed-return-durable-status-rejected:unknown",
      ],
    });
    expect(canCompleteFullFiscalYearLedger(blocked)).toBe(false);
  });

  // Equality between the immediate and persisted copies cannot catch the shared
  // text losing its remedy -- both derive from one source, so both drift
  // together and still agree. Every state that names a remedy needs a row here.
  it.each([
    ["full-fiscal-year-pinned-gst-tab-unavailable", "Cancel and reset"],
    ["full-fiscal-year-gst-tab-session-unavailable", "open in the foreground"],
  ])("persists the specific remedy for %s", (signal, remedy) => {
    const ledger = createLedger([["April", "pending"]]);
    const targetId = ledger.targets[0]!.targetId;
    const persisted = markFullFiscalYearTargetTerminal(
      ledger,
      targetId,
      "blocked",
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "blocked",
        safeSignals: [signal],
        safeMessage: "Pack stopped safely.",
      },
      new Date("2026-06-24T00:01:00.000Z"),
    );

    expect(persisted.targets[0]!).toMatchObject({ safeSignals: [signal] });
    expect(persisted.targets[0]!.safeMessage).toContain(remedy);
    expect(isFullFiscalYearLedger(persisted)).toBe(true);
  });

  it("retains fixed GSTR-3B observation signals when a full-year target stops before acquisition", () => {
    const ledger = createLedger([["April", "pending"]]);
    const targetId = ledger.targets[0]!.targetId;
    const terminal = markFullFiscalYearTargetTerminal(
      ledger,
      targetId,
      "blocked",
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "user-action-required",
        safeSignals: [
          "gstr-3b-detail-route",
          "filed-returns-heading",
          "gstr-3b",
          "filed",
          "download",
          "pdf",
          "detail-ready-step-limit-reached",
        ],
        safeMessage:
          "Pack is waiting for the GST Portal detail page to expose its download control.",
      },
      new Date("2026-06-24T00:01:00.000Z"),
    );

    expect(terminal.targets[0]).toMatchObject({
      status: "blocked",
      safeSignals: expect.arrayContaining(["gstr-3b-detail-route", "gstr-3b"]),
    });
    expect(terminal.targets[0]?.safeSignals).not.toContain("filed-return-durable-status-rejected");
  });

  it("retains a missing JSON staging signal instead of replacing it with a generic rejection", () => {
    const ledger = createLedger([["April", "pending"]], { artifactType: "JSON" });
    const targetId = ledger.targets[0]!.targetId;
    const staged = requireFullFiscalYearArtifactsStaged(
      {
        artifactType: "JSON",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-3B",
      },
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-json-private-v0",
        state: "downloaded",
        safeSignals: [],
        safeMessage: "Pack observed the portal download.",
      },
    );
    const terminal = markFullFiscalYearTargetTerminal(
      ledger,
      targetId,
      "blocked",
      staged,
      new Date("2026-06-24T00:01:00.000Z"),
    );

    expect(terminal.targets[0]?.safeSignals).toContain("full-fiscal-year-artifact-not-staged:JSON");
    expect(terminal.targets[0]?.safeSignals).not.toContain("filed-return-durable-status-rejected");
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
  const createdTargets = targets.map(([period, status]) =>
    createTarget(period, status, { artifactType, returnType }),
  );
  return {
    schemaVersion: "1.0",
    ...(eligibleThrough
      ? {
          planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
          eligibleThrough,
          targetPlan: createdTargets.map((target) => ({
            targetId: target.targetId,
            financialYear: target.financialYear,
            period: target.period,
            returnType: target.returnType,
            ...(target.artifactType ? { artifactType: target.artifactType } : {}),
          })),
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
    targets: createdTargets,
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
  const artifactTypes = concreteFiledReturnsArtifactTypesForSelection(returnType, artifactType);
  const diagnostics = artifactTypes.map((concreteArtifactType, index) => {
    const periodIndex = FILED_RETURNS_MONTHS.indexOf(period);
    const actionIndex = periodIndex * 3 + index + 1;
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
            ? concreteArtifactType === "JSON"
              ? ("gstr2b-main-world-json-captured-download" as const)
              : ("gstr2b-portal-blob-captured-download" as const)
            : concreteArtifactType === "PDF"
              ? ("gstr1-pdf-portal-blob-captured-download" as const)
              : ("gstr1-excel-portal-blob-captured-download" as const),
      artifactType: concreteArtifactType,
      downloadPathClass: "captured-portal-request-data" as const,
      status: "downloaded" as const,
      mimeClass:
        concreteArtifactType === "PDF"
          ? ("pdf" as const)
          : concreteArtifactType === "JSON"
            ? ("json" as const)
            : ("spreadsheet" as const),
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
  artifactType: "PDF" | "EXCEL" | "JSON",
  actionId: string,
): FiledReturnsDownloadDiagnostic {
  return {
    schemaVersion: "1.0",
    eventType: "filed-return-download-path",
    actionId,
    returnType: "GSTR-2B",
    financialYear: "2026-27",
    period: "April",
    endpointClass:
      artifactType === "JSON"
        ? "gstr2b-main-world-json-captured-download"
        : "gstr2b-portal-blob-captured-download",
    artifactType,
    downloadPathClass: "captured-portal-request-blob",
    downloadId: artifactType === "PDF" ? 41 : artifactType === "EXCEL" ? 42 : 43,
    status: "downloaded",
    mimeClass: artifactType === "PDF" ? "pdf" : artifactType === "JSON" ? "json" : "spreadsheet",
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypesForSelection,
  type FiledReturnsConcreteArtifactType,
} from "../../src/connectors/gst/filed-returns-artifacts";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";

type SyntheticBundleArtifact = {
  artifactType: FiledReturnsConcreteArtifactType;
  safeSignals: string[];
  status: "pending" | "running" | "staged" | "unavailable";
};

type SyntheticBundleLedger = {
  artifactPlan: FiledReturnsConcreteArtifactType[];
  artifacts: SyntheticBundleArtifact[];
  ledgerId: string;
  phase: "collecting" | "ready-for-zip" | "zip-intent-persisted";
  revision: number;
  scope: FiledReturnsDownloadScope;
};

const mocks = vi.hoisted(() => ({
  combineDownloadedArtifactFlowSteps: vi.fn(
    (combined: PortalFlowStepResult | null, next: PortalFlowStepResult) => ({
      ...next,
      safeSignals: Array.from(new Set([...(combined?.safeSignals ?? []), ...next.safeSignals])),
    }),
  ),
  markArtifactProgressNeedsReview: vi.fn((flowStep: PortalFlowStepResult) => flowStep),
  persistPartialArtifactSummary:
    vi.fn<
      (
        scope: FiledReturnsDownloadScope,
        flowStep: PortalFlowStepResult,
        ...args: unknown[]
      ) => Promise<FiledReturnsFlowSummary>
    >(),
  readPersistedArtifactProgress: vi.fn<
    (...args: unknown[]) => Promise<{
      completedArtifactTypes: Array<"PDF" | "JSON" | "EXCEL">;
      flowStep: PortalFlowStepResult;
    } | null>
  >(),
  selectedArtifactsSafeMessage: vi.fn(() => "Selected artifacts downloaded."),
  toOptionalArtifactUnavailableFlowStep: vi.fn(() => null),
  gstr1VisibleScopeMismatchResponse: vi.fn<(...args: unknown[]) => PackMessageResponse | null>(
    () => null,
  ),
  triggerAndObserveFiledReturnDownload: vi.fn(),
}));
const bundleMocks = vi.hoisted(() => {
  const transition = (
    ledger: SyntheticBundleLedger,
    artifactType: FiledReturnsConcreteArtifactType,
    status: "running" | "staged" | "unavailable",
  ) => {
    const artifacts = ledger.artifacts.map((artifact) =>
      artifact.artifactType === artifactType ? { ...artifact, status } : artifact,
    );
    const terminal = artifacts.every((artifact) =>
      ["staged", "unavailable"].includes(artifact.status),
    );
    return {
      ...ledger,
      artifacts,
      phase: terminal ? "ready-for-zip" : "collecting",
      revision: ledger.revision + 1,
    };
  };
  const flowStep = (ledger: SyntheticBundleLedger): PortalFlowStepResult | null => {
    const missing = ledger.artifacts.filter((artifact) => artifact.status === "unavailable");
    const staged = ledger.artifacts.filter((artifact) => artifact.status === "staged");
    if (staged.length + missing.length === 0) return null;
    return {
      connectorId: "gst",
      scopeId: "gst-gstr2b-private-v0",
      state: missing.length > 0 ? "partial" : "downloaded",
      safeSignals: staged.flatMap((artifact) => [
        "single-period-opfs-staged",
        `single-period-opfs-staged:${artifact.artifactType}`,
        `filed-return-artifact-downloaded:${artifact.artifactType}`,
      ]),
      safeMessage:
        missing.length > 0
          ? `Pack prepared a partial ZIP; missing ${missing
              .map((artifact) => `${artifact.artifactType} (artifact-generation-timeout)`)
              .join(", ")}.`
          : "Synthetic staged bundle.",
    };
  };
  return {
    clearSinglePeriodBundleLedger: vi.fn(async () => true),
    persistSinglePeriodBundleArtifactReview: vi.fn(async (ledger: SyntheticBundleLedger) => ({
      ...ledger,
      phase: "artifact-review" as const,
      revision: ledger.revision + 1,
    })),
    persistSinglePeriodBundleArtifactRunning: vi.fn(
      async (ledger: SyntheticBundleLedger, artifactType: FiledReturnsConcreteArtifactType) =>
        transition(ledger, artifactType, "running"),
    ),
    persistSinglePeriodBundleArtifactStaged: vi.fn(
      async (
        ledger: SyntheticBundleLedger,
        artifactType: FiledReturnsConcreteArtifactType,
        flowStep: PortalFlowStepResult,
      ) =>
        flowStep.safeSignals.includes(`filed-return-artifact-downloaded:${artifactType}`)
          ? transition(ledger, artifactType, "staged")
          : null,
    ),
    persistSinglePeriodBundleArtifactUnavailable: vi.fn(
      async (ledger: SyntheticBundleLedger, artifactType: FiledReturnsConcreteArtifactType) =>
        transition(ledger, artifactType, "unavailable"),
    ),
    persistSinglePeriodBundleCleanupPending: vi.fn(async (ledger: SyntheticBundleLedger) => ledger),
    persistSinglePeriodBundleZipDownloadId: vi.fn(async (ledger: SyntheticBundleLedger) => ledger),
    persistSinglePeriodBundleZipIntent: vi.fn(async (ledger: SyntheticBundleLedger) => ledger),
    readSinglePeriodBundleLedgerStorageState: vi.fn(),
    reserveSinglePeriodBundleLedger: vi.fn(async (scope: FiledReturnsDownloadScope) => ({
      state: "created",
      ledger: {
        artifactPlan: ["PDF", "EXCEL", "JSON"],
        artifacts: ["PDF", "EXCEL", "JSON"].map((artifactType) => ({
          artifactType,
          safeSignals: [],
          status: "pending",
        })),
        ledgerId: "single-period-synthetic",
        phase: "collecting",
        revision: 1,
        scope,
      },
    })),
    sameSinglePeriodBundleScope: vi.fn(
      (left: FiledReturnsDownloadScope, right: FiledReturnsDownloadScope) =>
        left.returnType === right.returnType &&
        left.financialYear === right.financialYear &&
        left.period === right.period &&
        (left.artifactType ?? "PDF") === (right.artifactType ?? "PDF"),
    ),
    singlePeriodBundleEntryPlan: vi.fn((ledger: SyntheticBundleLedger) => ({
      artifactTypes: ledger.artifacts
        .filter((artifact) => artifact.status === "staged")
        .map((artifact) => artifact.artifactType),
      unavailableArtifactTypes: ledger.artifacts
        .filter((artifact) => artifact.status === "unavailable")
        .map((artifact) => artifact.artifactType),
    })),
    singlePeriodBundleFlowStep: vi.fn(flowStep),
    exportSinglePeriodFiledReturnsZip: vi.fn(
      async ({ completeStep }: { completeStep: PortalFlowStepResult }) => completeStep,
    ),
  };
});

vi.mock("wxt/browser", () => ({ browser: { storage: { local: {}, session: {} } } }));
vi.mock("../../src/background/filed-returns-artifact-progress", () => mocks);
vi.mock("../../src/background/filed-returns-download-trigger", () => ({
  gstr1VisibleScopeMismatchResponse: mocks.gstr1VisibleScopeMismatchResponse,
  triggerAndObserveFiledReturnDownload: mocks.triggerAndObserveFiledReturnDownload,
}));
vi.mock("../../src/background/filed-returns-single-period-bundle-ledger", () => bundleMocks);
vi.mock("../../src/background/filed-returns-single-period-zip", () => ({
  exportSinglePeriodFiledReturnsZip: bundleMocks.exportSinglePeriodFiledReturnsZip,
}));

import {
  preflightSelectedArtifactsRecovery,
  triggerSelectedArtifacts,
} from "../../src/background/filed-returns-selected-artifacts";

const gstr2bAllFormatsArtifacts = concreteFiledReturnsArtifactTypesForSelection(
  "GSTR-2B",
  "PDF_AND_EXCEL",
);

describe("GSTR-2B all-format selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readPersistedArtifactProgress.mockResolvedValue(null);
    mocks.persistPartialArtifactSummary.mockImplementation(async (scope, flowStep) => ({
      scope,
      status: "partial",
      completedPeriods: [],
      currentPeriod: scope.period,
      totalPeriods: 1,
      updatedAt: "2026-07-27T00:00:00.000Z",
      flowStep,
    }));
  });

  it.each([
    ["GSTR-1 PDF", { artifactType: "PDF", returnType: "GSTR-1" }],
    ["GSTR-3B PDF", { artifactType: "PDF", returnType: "GSTR-3B" }],
    ["GSTR-2B JSON", { artifactType: "JSON", returnType: "GSTR-2B" }],
  ] as const)("does not let a retained GSTR-2B bundle shadow %s", async (_label, target) => {
    bundleMocks.readSinglePeriodBundleLedgerStorageState.mockResolvedValue({
      state: "valid",
      ledger: retainedGstr2bBundle(),
    });

    await expect(
      preflightSelectedArtifactsRecovery({
        deps: {} as never,
        scope: {
          ...target,
          financialYear: "2026-27",
          period: "June",
        },
      }),
    ).resolves.toBeNull();
  });

  it("keeps a retained GSTR-2B bundle bound to its own exact selection", async () => {
    bundleMocks.readSinglePeriodBundleLedgerStorageState.mockResolvedValue({
      state: "valid",
      ledger: retainedGstr2bBundle(),
    });

    const response = await preflightSelectedArtifactsRecovery({
      deps: {} as never,
      scope: retainedGstr2bBundle().scope,
    });

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["single-period-zip-download-reconciliation-required"]),
      },
    });
  });

  it("keeps a single artifact loose and never starts ZIP staging or export", async () => {
    mocks.triggerAndObserveFiledReturnDownload.mockResolvedValueOnce({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "downloaded",
        safeSignals: ["extension-download-complete"],
        safeMessage: "Pack saved the selected loose file.",
      },
    });

    const response = await triggerSelectedArtifacts({
      activePeriod: "June",
      deps: { storageKeys: {} } as never,
      scope: {
        artifactType: "JSON",
        financialYear: "2026-27",
        period: "June",
        returnType: "GSTR-2B",
      },
      tabId: 17,
    });

    expect(mocks.triggerAndObserveFiledReturnDownload).toHaveBeenCalledOnce();
    expect(
      mocks.triggerAndObserveFiledReturnDownload.mock.calls[0]?.[0].deps.stageCapturedDownloads,
    ).toBeUndefined();
    expect(bundleMocks.exportSinglePeriodFiledReturnsZip).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowStep: { state: "downloaded" } });
  });

  it("preserves a known GSTR-1 scope mismatch before marking a bundle artifact running", async () => {
    mocks.gstr1VisibleScopeMismatchResponse.mockReturnValueOnce({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "blocked",
        safeSignals: ["filed-gstr1-visible-scope-mismatch"],
        safeMessage:
          "Pack found filed GSTR-1 for June 2026-27, but this run requested April 2026-27. Pack did not start artifact acquisition.",
      },
    });

    const response = await triggerSelectedArtifacts({
      activeFinancialYear: "2026-27",
      activePeriod: "June",
      deps: { storageKeys: {} } as never,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-1",
      },
      tabId: 17,
    });

    expect(response).toMatchObject({
      flowStep: {
        safeMessage: expect.stringContaining("June 2026-27"),
        state: "blocked",
      },
    });
    expect(response).toMatchObject({
      flowStep: { safeMessage: expect.stringContaining("April 2026-27") },
    });
    expect(bundleMocks.persistSinglePeriodBundleArtifactRunning).not.toHaveBeenCalled();
    expect(mocks.triggerAndObserveFiledReturnDownload).not.toHaveBeenCalled();
  });

  it("keeps waiting for the GSTR-1 Excel detail page beyond the generic flow limit", async () => {
    mocks.triggerAndObserveFiledReturnDownload.mockImplementation(
      async ({ artifactType }: { artifactType: FiledReturnsConcreteArtifactType }) =>
        downloaded(artifactType),
    );
    const pendingStep: PackMessageResponse = {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "clicked",
        safeSignals: ["filed-gstr1-controls-pending"],
        safeMessage: "Pack is waiting for the authenticated GSTR-1 page controls.",
      },
    };
    const readyStep: PackMessageResponse = {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "ready",
        safeSignals: [
          "filed-return-download-ready",
          "filed-gstr1-download-ready",
          "filed-return-detail-period:April",
          "filed-return-detail-financial-year:2026-27",
        ],
        safeMessage: "Pack found the target-bound GSTR-1 Excel control.",
      },
    };
    const responses = [
      pendingStep,
      pendingStep,
      pendingStep,
      pendingStep,
      pendingStep,
      pendingStep,
      readyStep,
    ];
    const sendMessageToTabWithInjection = vi.fn(async () => responses.shift() ?? readyStep);

    const response = await triggerSelectedArtifacts({
      activeFinancialYear: "2026-27",
      activePeriod: "April",
      deps: {
        sendMessageToTabWithInjection,
        stageCapturedDownloads: { ledgerId: "full-year-synthetic" },
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "ledger",
          observation: "observation",
        },
        timings: { flowStepSettleMs: 0, portalNavigationSettleMs: 0 },
      } as never,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-1",
      },
      tabId: 17,
    });

    expect(response).toMatchObject({ flowStep: { state: "downloaded" } });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(7);
    expect(
      mocks.triggerAndObserveFiledReturnDownload.mock.calls.map(([input]) => input.artifactType),
    ).toEqual(["PDF", "EXCEL"]);
  });

  it("stops the GSTR-1 Excel handoff at its bounded retry limit without triggering Excel", async () => {
    mocks.triggerAndObserveFiledReturnDownload.mockImplementation(
      async ({ artifactType }: { artifactType: FiledReturnsConcreteArtifactType }) =>
        downloaded(artifactType),
    );
    const pendingStep: PackMessageResponse = {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "clicked",
        safeSignals: ["filed-gstr1-controls-pending"],
        safeMessage: "Pack is waiting for the authenticated GSTR-1 page controls.",
      },
    };
    const sendMessageToTabWithInjection = vi.fn(async () => pendingStep);

    const response = await triggerSelectedArtifacts({
      activeFinancialYear: "2026-27",
      activePeriod: "April",
      deps: {
        sendMessageToTabWithInjection,
        stageCapturedDownloads: { ledgerId: "full-year-synthetic" },
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "ledger",
          observation: "observation",
        },
        timings: { flowStepSettleMs: 0, portalNavigationSettleMs: 0 },
      } as never,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-1",
      },
      tabId: 17,
    });

    expect(response).toMatchObject({
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["gstr1-excel-detail-step-limit-reached"]),
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledTimes(30);
    expect(
      mocks.triggerAndObserveFiledReturnDownload.mock.calls.map(([input]) => input.artifactType),
    ).toEqual(["PDF"]);
  });

  it("stages PDF, Excel, and JSON, then exports one ZIP", async () => {
    mocks.triggerAndObserveFiledReturnDownload
      .mockResolvedValueOnce(downloaded(gstr2bAllFormatsArtifacts[0]!))
      .mockResolvedValueOnce(downloaded(gstr2bAllFormatsArtifacts[1]!))
      .mockResolvedValueOnce(downloaded(gstr2bAllFormatsArtifacts[2]!));

    const response = await triggerSelectedArtifacts({
      activePeriod: "June",
      deps: {
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "ledger",
          observation: "observation",
        },
      } as never,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "June",
        returnType: "GSTR-2B",
      },
      tabId: 17,
    });

    expect(
      mocks.triggerAndObserveFiledReturnDownload.mock.calls.map(([input]) => input.artifactType),
    ).toEqual(gstr2bAllFormatsArtifacts);
    expect(
      mocks.triggerAndObserveFiledReturnDownload.mock.calls.map(
        ([input]) => input.deps.stageCapturedDownloads,
      ),
    ).toEqual([
      { bundleKind: "single-period", ledgerId: "single-period-synthetic" },
      { bundleKind: "single-period", ledgerId: "single-period-synthetic" },
      { bundleKind: "single-period", ledgerId: "single-period-synthetic" },
    ]);
    expect(bundleMocks.exportSinglePeriodFiledReturnsZip).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      flowStep: { state: "downloaded" },
    });
  });

  it("does not reuse direct-download progress while staging a fiscal-year artifact ledger", async () => {
    mocks.readPersistedArtifactProgress.mockResolvedValue({
      completedArtifactTypes: ["PDF"],
      flowStep: downloaded("PDF").flowStep as PortalFlowStepResult,
    });
    mocks.triggerAndObserveFiledReturnDownload
      .mockResolvedValueOnce(downloaded("PDF"))
      .mockResolvedValueOnce(downloaded("EXCEL"))
      .mockResolvedValueOnce(downloaded("JSON"));

    await triggerSelectedArtifacts({
      activePeriod: "June",
      deps: {
        stageCapturedDownloads: { bundleKind: "full-fiscal-year", ledgerId: "full-year-synthetic" },
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "ledger",
          observation: "observation",
        },
      } as never,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "June",
        returnType: "GSTR-2B",
      },
      tabId: 17,
    });

    expect(mocks.readPersistedArtifactProgress).not.toHaveBeenCalled();
    expect(
      mocks.triggerAndObserveFiledReturnDownload.mock.calls.map(([input]) => input.artifactType),
    ).toEqual(gstr2bAllFormatsArtifacts);
    expect(
      mocks.triggerAndObserveFiledReturnDownload.mock.calls.map(
        ([input]) => input.deps.stageCapturedDownloads,
      ),
    ).toEqual([
      { bundleKind: "full-fiscal-year", ledgerId: "full-year-synthetic" },
      { bundleKind: "full-fiscal-year", ledgerId: "full-year-synthetic" },
      { bundleKind: "full-fiscal-year", ledgerId: "full-year-synthetic" },
    ]);
  });

  it("routes an ambiguous acquisition failure to review instead of exporting a partial ZIP", async () => {
    bundleMocks.persistSinglePeriodBundleArtifactUnavailable.mockResolvedValueOnce(null as never);
    mocks.triggerAndObserveFiledReturnDownload
      .mockResolvedValueOnce(downloaded("PDF"))
      .mockResolvedValueOnce(blocked("EXCEL"))
      .mockResolvedValueOnce(downloaded("JSON"));

    const response = await triggerSelectedArtifacts({
      activePeriod: "June",
      deps: {
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "ledger",
          observation: "observation",
        },
      } as never,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "June",
        returnType: "GSTR-2B",
      },
      tabId: 17,
    });

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining(["artifact-generation-timeout"]),
      },
    });
    expect(bundleMocks.exportSinglePeriodFiledReturnsZip).not.toHaveBeenCalled();
  });

  it("retains a rejected staged JSON delivery for recovery instead of leaving it untracked", async () => {
    mocks.triggerAndObserveFiledReturnDownload.mockImplementation(
      async ({ artifactType }: { artifactType: FiledReturnsConcreteArtifactType }) =>
        artifactType === "JSON"
          ? blocked("JSON", "artifact-delivery-unconfirmed")
          : downloaded(artifactType),
    );

    await triggerSelectedArtifacts({
      activePeriod: "June",
      deps: {
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "ledger",
          observation: "observation",
        },
      } as never,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "June",
        returnType: "GSTR-2B",
      },
      tabId: 17,
    });

    expect(bundleMocks.persistSinglePeriodBundleArtifactReview).toHaveBeenCalledWith(
      expect.objectContaining({
        artifacts: expect.arrayContaining([
          expect.objectContaining({ artifactType: "JSON", status: "running" }),
        ]),
      }),
      "JSON",
      expect.objectContaining({ safeSignals: ["artifact-delivery-unconfirmed"] }),
      expect.any(Date),
    );
    expect(bundleMocks.persistSinglePeriodBundleArtifactUnavailable).not.toHaveBeenCalled();
  });
});

function downloaded(artifactType: string) {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-gstr2b-private-v0",
      state: "downloaded",
      safeSignals: [
        `synthetic-${artifactType.toLowerCase()}-downloaded`,
        "single-period-opfs-staged",
        `single-period-opfs-staged:${artifactType}`,
      ],
      safeMessage: `${artifactType} downloaded.`,
    },
  };
}

function blocked(artifactType: string, safeSignal = "artifact-generation-timeout") {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-gstr2b-private-v0",
      state: "blocked",
      safeSignals: [safeSignal],
      safeMessage: `${artifactType} failed.`,
    },
  };
}

function retainedGstr2bBundle(): SyntheticBundleLedger {
  return {
    artifactPlan: ["PDF", "EXCEL", "JSON"],
    artifacts: (["PDF", "EXCEL", "JSON"] as const).map((artifactType) => ({
      artifactType,
      safeSignals: [],
      status: "staged",
    })),
    ledgerId: "single-period:12345678-retained",
    phase: "zip-intent-persisted",
    revision: 7,
    scope: {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    },
  };
}

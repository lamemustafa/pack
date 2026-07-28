import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import type { FiledReturnsConcreteArtifactType } from "../../src/connectors/gst/filed-returns-artifacts";

type SyntheticBundleArtifact = {
  artifactType: FiledReturnsConcreteArtifactType;
  safeSignals: string[];
  status: "pending" | "running" | "staged" | "unavailable";
};

type SyntheticBundleLedger = {
  artifactPlan: FiledReturnsConcreteArtifactType[];
  artifacts: SyntheticBundleArtifact[];
  ledgerId: string;
  phase: "collecting" | "ready-for-zip";
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
    persistSinglePeriodBundleArtifactReview: vi.fn(async (ledger: SyntheticBundleLedger) => ledger),
    persistSinglePeriodBundleArtifactRunning: vi.fn(
      async (ledger: SyntheticBundleLedger, artifactType: FiledReturnsConcreteArtifactType) =>
        transition(ledger, artifactType, "running"),
    ),
    persistSinglePeriodBundleArtifactStaged: vi.fn(
      async (ledger: SyntheticBundleLedger, artifactType: FiledReturnsConcreteArtifactType) =>
        transition(ledger, artifactType, "staged"),
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
    sameSinglePeriodBundleScope: vi.fn(() => true),
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
  triggerAndObserveFiledReturnDownload: mocks.triggerAndObserveFiledReturnDownload,
}));
vi.mock("../../src/background/filed-returns-single-period-bundle-ledger", () => bundleMocks);
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => ({
  exportSinglePeriodFiledReturnsZip: bundleMocks.exportSinglePeriodFiledReturnsZip,
}));

import { triggerSelectedArtifacts } from "../../src/background/filed-returns-selected-artifacts";

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

  it("stages PDF, Excel, and JSON, then exports one ZIP", async () => {
    mocks.triggerAndObserveFiledReturnDownload
      .mockResolvedValueOnce(downloaded("PDF"))
      .mockResolvedValueOnce(downloaded("EXCEL"))
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

    expect(
      mocks.triggerAndObserveFiledReturnDownload.mock.calls.map(([input]) => input.artifactType),
    ).toEqual(["PDF", "EXCEL", "JSON"]);
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

  it("exports successes as partial and names the missing artifact reason", async () => {
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
        state: "partial",
        safeMessage: expect.stringContaining("EXCEL (artifact-generation-timeout)"),
      },
    });
    expect(bundleMocks.exportSinglePeriodFiledReturnsZip).toHaveBeenCalledOnce();
  });
});

function downloaded(artifactType: string) {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-gstr2b-private-v0",
      state: "downloaded",
      safeSignals: [`synthetic-${artifactType.toLowerCase()}-downloaded`],
      safeMessage: `${artifactType} downloaded.`,
    },
  };
}

function blocked(artifactType: string) {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-gstr2b-private-v0",
      state: "blocked",
      safeSignals: ["artifact-generation-timeout"],
      safeMessage: `${artifactType} failed.`,
    },
  };
}

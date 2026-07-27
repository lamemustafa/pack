import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";

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

vi.mock("wxt/browser", () => ({ browser: { storage: { local: {}, session: {} } } }));
vi.mock("../../src/background/filed-returns-artifact-progress", () => mocks);
vi.mock("../../src/background/filed-returns-download-trigger", () => ({
  triggerAndObserveFiledReturnDownload: mocks.triggerAndObserveFiledReturnDownload,
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

  it("runs PDF, Excel, and JSON independently without staging a ZIP", async () => {
    mocks.triggerAndObserveFiledReturnDownload
      .mockResolvedValueOnce(blocked("PDF"))
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
    ).toEqual([undefined, undefined, undefined]);
    expect(mocks.persistPartialArtifactSummary).toHaveBeenCalled();
    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "filed-return-artifact-failed:PDF",
          "filed-return-artifact-downloaded:EXCEL",
          "filed-return-artifact-downloaded:JSON",
        ]),
      },
      flowSummary: {
        status: "partial",
        flowStep: { state: "blocked" },
      },
    });
  });

  it("resumes only the unfinished GSTR-2B artifact after a partial summary", async () => {
    mocks.readPersistedArtifactProgress.mockResolvedValue({
      completedArtifactTypes: ["PDF", "JSON"],
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "blocked",
        safeSignals: [
          "filed-return-artifact-downloaded:PDF",
          "filed-return-artifact-downloaded:JSON",
          "filed-return-artifact-failed:EXCEL",
        ],
        safeMessage: "Synthetic partial progress.",
      },
    });
    mocks.triggerAndObserveFiledReturnDownload.mockResolvedValueOnce(downloaded("EXCEL"));

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

    expect(
      mocks.triggerAndObserveFiledReturnDownload.mock.calls.map(([input]) => input.artifactType),
    ).toEqual(["EXCEL"]);
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
      safeSignals: [`synthetic-${artifactType.toLowerCase()}-failed`],
      safeMessage: `${artifactType} failed.`,
    },
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAfterPersist: vi.fn(async () => undefined),
  persist: vi.fn(),
  readCompletionEvidence: vi.fn(async () => []),
  readTargetReview: vi.fn(async () => null),
  clearTargetReview: vi.fn(async () => true),
}));
vi.mock("../../src/background/filed-returns-session-summary", () => ({
  persistCanonicalFiledReturnsFlowSummary: mocks.persist,
}));
vi.mock("../../src/background/artifact-acquisition-state", () => ({
  clearArtifactAcquisitionCheckpointsAfterPersistedSummary: mocks.clearAfterPersist,
  readArtifactAcquisitionCompletionEvidence: mocks.readCompletionEvidence,
}));
vi.mock("../../src/background/filed-returns-target-review", () => ({
  clearFiledReturnsTargetReview: mocks.clearTargetReview,
  readFiledReturnsTargetReview: mocks.readTargetReview,
}));
import { withPersistedSinglePeriodSummary } from "../../src/background/filed-returns-single-period-summary";

describe("GSTR-3B artifact checkpoint completion ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCompletionEvidence.mockResolvedValue([]);
    mocks.readTargetReview.mockResolvedValue(null);
    mocks.clearTargetReview.mockResolvedValue(true);
  });

  it("clears artifact checkpoint ownership only after completion persists", async () => {
    mocks.persist.mockImplementation(async () => {
      expect(mocks.clearAfterPersist).not.toHaveBeenCalled();
      return { completedPeriods: ["April"], flowStep: step(), scope, status: "complete" };
    });
    const response = await withPersistedSinglePeriodSummary(
      scope,
      { ok: true, flowStep: step() },
      {
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "ledger",
          observation: "observation",
        },
      } as never,
      true,
    );
    expect(response).toMatchObject({ flowSummary: { status: "complete" } });
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.clearAfterPersist).toHaveBeenCalledWith(scope, []);
  });

  it("clears only the matching durable single-artifact attempt after completion persists", async () => {
    mocks.persist.mockImplementation(async () => {
      expect(mocks.clearTargetReview).not.toHaveBeenCalled();
      return { completedPeriods: ["April"], flowStep: matchingStep(), scope, status: "complete" };
    });
    mocks.readTargetReview.mockResolvedValue({
      downloadAttempt: {
        actionId: "00000000-0000-4000-8000-000000000111",
        artifactType: "PDF",
        downloadId: 111,
        kind: "single-artifact",
        phase: "download-observing",
        requestedAt: "2026-08-05T00:00:00.000Z",
      },
      revision: 2,
    } as never);

    await withPersistedSinglePeriodSummary(
      scope,
      { ok: true, flowStep: matchingStep() },
      deps(),
      true,
    );

    expect(mocks.clearTargetReview).toHaveBeenCalledWith(scope, expect.anything(), 2);
  });

  it("retains a same-scope replacement attempt whose exact identity differs", async () => {
    mocks.persist.mockResolvedValue({
      completedPeriods: ["April"],
      flowStep: matchingStep(),
      scope,
      status: "complete",
    });
    mocks.readTargetReview.mockResolvedValue({
      downloadAttempt: {
        actionId: "00000000-0000-4000-8000-000000000112",
        artifactType: "PDF",
        downloadId: 112,
        kind: "single-artifact",
        phase: "download-observing",
        requestedAt: "2026-08-05T00:00:00.000Z",
      },
      revision: 2,
    } as never);

    await withPersistedSinglePeriodSummary(
      scope,
      { ok: true, flowStep: matchingStep() },
      deps(),
      true,
    );

    expect(mocks.clearTargetReview).not.toHaveBeenCalled();
  });
});

function deps() {
  return {
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "ledger",
      observation: "observation",
    },
  } as never;
}

const scope = {
  artifactType: "PDF" as const,
  financialYear: "2024-25",
  period: "April",
  returnType: "GSTR-3B" as const,
};
function step() {
  return {
    connectorId: "gst" as const,
    scopeId: "gst-filed-returns-gstr-3b",
    state: "downloaded" as const,
    safeMessage: "Saved.",
    safeSignals: [],
  };
}

function matchingStep() {
  return {
    ...step(),
    downloadDiagnostic: {
      actionId: "00000000-0000-4000-8000-000000000111",
      artifactType: "PDF" as const,
      byteCountClass: "non-empty" as const,
      downloadId: 111,
      downloadPathClass: "captured-portal-request-unknown" as const,
      endpointClass: "gstr3b-portal-blob-captured-download" as const,
      eventType: "filed-return-download-path" as const,
      financialYear: scope.financialYear,
      mimeClass: "pdf" as const,
      period: scope.period,
      returnType: scope.returnType,
      schemaVersion: "1.0" as const,
      status: "downloaded" as const,
    },
  };
}

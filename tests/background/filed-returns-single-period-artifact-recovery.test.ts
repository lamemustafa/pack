import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcileArtifactAcquisitionCheckpoint: vi.fn(),
  persistFiledReturnsTargetReview: vi.fn(),
  readArtifactAcquisitionCompletionMarker: vi.fn(),
  preflightSelectedArtifactsRecovery: vi.fn(),
}));

vi.mock("../../src/background/artifact-acquisition-state", () => ({
  reconcileArtifactAcquisitionCheckpoint: mocks.reconcileArtifactAcquisitionCheckpoint,
}));
vi.mock("../../src/background/filed-returns-target-review", () => ({
  persistFiledReturnsTargetReview: mocks.persistFiledReturnsTargetReview,
  readArtifactAcquisitionCompletionMarker: mocks.readArtifactAcquisitionCompletionMarker,
}));
vi.mock("../../src/background/filed-returns-selected-artifacts", () => ({
  preflightSelectedArtifactsRecovery: mocks.preflightSelectedArtifactsRecovery,
  triggerSelectedArtifacts: vi.fn(),
}));

import { startSinglePeriodFiledReturnsDownloadFlow } from "../../src/background/filed-returns-single-period-flow";

const scope = {
  artifactType: "PDF" as const,
  financialYear: "2025-26",
  period: "May",
  returnType: "GSTR-3B" as const,
};

describe("GSTR-3B artifact acquisition recovery", () => {
  const persistedReview = {
    completedPeriods: [],
    flowStep: {
      connectorId: "gst" as const,
      safeMessage: "Pack retained unresolved artifact download recovery.",
      safeSignals: [
        "filed-returns-target-review-required",
        "artifact-acquisition-download-interrupted",
      ],
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "user-action-required" as const,
      userAction: {
        canResume: true,
        message: "Review or cancel this target before starting another portal action.",
        type: "RETRY_PORTAL_GENERATION" as const,
      },
    },
    scope,
    status: "blocked" as const,
    totalPeriods: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistFiledReturnsTargetReview.mockResolvedValue(persistedReview);
    mocks.readArtifactAcquisitionCompletionMarker.mockResolvedValue(null);
    mocks.preflightSelectedArtifactsRecovery.mockResolvedValue(null);
  });

  it("returns the durable completion without repeating a proved single target", async () => {
    mocks.readArtifactAcquisitionCompletionMarker.mockResolvedValue({
      artifactAcquisitionCompletion: [
        {
          artifactType: "PDF",
          downloadId: 9,
          requestId: "00000000-0000-4000-8000-000000000001",
        },
      ],
    });
    const getActiveGstTab = vi.fn();

    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, {
      getActiveGstTab,
      now: () => new Date("2026-08-02T00:00:00.000Z"),
      storageKeys: { targetReview: "target-review" },
    } as never);

    expect(mocks.reconcileArtifactAcquisitionCheckpoint).not.toHaveBeenCalled();
    expect(mocks.persistFiledReturnsTargetReview).not.toHaveBeenCalled();
    expect(getActiveGstTab).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      flowStep: { state: "downloaded" },
      flowSummary: {
        artifactAcquisitionCompletion: [{ artifactType: "PDF", downloadId: 9 }],
        status: "complete",
      },
    });
  });

  it("keeps an interrupted checkpoint blocked without repeating the portal action", async () => {
    mocks.reconcileArtifactAcquisitionCheckpoint.mockResolvedValue({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-interrupted"],
    });
    const getActiveGstTab = vi.fn();

    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, {
      getActiveGstTab,
    } as never);

    expect(mocks.reconcileArtifactAcquisitionCheckpoint).toHaveBeenCalledWith(scope);
    expect(mocks.persistFiledReturnsTargetReview).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ safeSignals: ["artifact-acquisition-download-interrupted"] }),
      expect.anything(),
    );
    expect(getActiveGstTab).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      flowStep: {
        state: "user-action-required",
        safeSignals: [
          "filed-returns-target-review-required",
          "artifact-acquisition-download-interrupted",
        ],
        userAction: { type: "RETRY_PORTAL_GENERATION", canResume: true },
      },
    });
  });

  it("persists all concrete checkpoint signals for a composite selection", async () => {
    const compositeScope = {
      ...scope,
      artifactType: "PDF_AND_EXCEL" as const,
      returnType: "GSTR-2B" as const,
    };
    mocks.reconcileArtifactAcquisitionCheckpoint
      .mockResolvedValueOnce({
        state: "needs-review",
        safeSignals: ["artifact-acquisition-download-interrupted"],
      })
      .mockResolvedValueOnce({
        state: "needs-review",
        safeSignals: ["artifact-acquisition-download-unconfirmed"],
      });

    await startSinglePeriodFiledReturnsDownloadFlow(compositeScope, {} as never);

    expect(mocks.reconcileArtifactAcquisitionCheckpoint).toHaveBeenNthCalledWith(1, {
      ...compositeScope,
      artifactType: "PDF",
    });
    expect(mocks.reconcileArtifactAcquisitionCheckpoint).toHaveBeenNthCalledWith(2, {
      ...compositeScope,
      artifactType: "EXCEL",
    });
    expect(mocks.persistFiledReturnsTargetReview).toHaveBeenCalledWith(
      compositeScope,
      expect.objectContaining({
        safeSignals: [
          "artifact-acquisition-download-interrupted",
          "artifact-acquisition-download-unconfirmed",
        ],
      }),
      expect.anything(),
    );
  });

  it("does not treat direct component markers as a delivered selected-files ZIP", async () => {
    const compositeScope = {
      ...scope,
      artifactType: "PDF_AND_EXCEL" as const,
      returnType: "GSTR-2B" as const,
    };
    mocks.readArtifactAcquisitionCompletionMarker.mockResolvedValue({
      artifactAcquisitionCompletion: [
        {
          artifactType: "PDF",
          downloadId: 9,
          requestId: "00000000-0000-4000-8000-000000000001",
        },
      ],
    });
    mocks.reconcileArtifactAcquisitionCheckpoint.mockResolvedValue({ state: "none" });
    mocks.preflightSelectedArtifactsRecovery.mockResolvedValue({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "user-action-required",
        safeSignals: ["single-period-opfs-staging-required"],
        safeMessage:
          "Pack still needs to stage the selected artifacts and hand off their ZIP before this selection is complete.",
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Start the selected-files download to stage the artifacts and save the ZIP.",
          canResume: true,
        },
      },
    });

    const response = await startSinglePeriodFiledReturnsDownloadFlow(compositeScope, {} as never, {
      persistSinglePeriodSummary: false,
    });

    expect(mocks.readArtifactAcquisitionCompletionMarker).not.toHaveBeenCalled();
    expect(mocks.reconcileArtifactAcquisitionCheckpoint).toHaveBeenNthCalledWith(1, {
      ...compositeScope,
      artifactType: "PDF",
    });
    expect(mocks.reconcileArtifactAcquisitionCheckpoint).toHaveBeenNthCalledWith(2, {
      ...compositeScope,
      artifactType: "EXCEL",
    });
    expect(mocks.preflightSelectedArtifactsRecovery).toHaveBeenCalledWith({
      deps: expect.anything(),
      scope: compositeScope,
    });
    expect(response).toMatchObject({
      flowStep: {
        state: "user-action-required",
        safeSignals: ["single-period-opfs-staging-required"],
        safeMessage:
          "Pack still needs to stage the selected artifacts and hand off their ZIP before this selection is complete.",
      },
    });
  });
});

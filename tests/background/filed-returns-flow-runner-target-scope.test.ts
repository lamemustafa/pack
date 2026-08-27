import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsTargetReview,
} from "../../src/connectors/gst/filed-returns-contracts";
import type * as FiledReturnsTargetReviewModule from "../../src/background/filed-returns-target-review";

const mocks = vi.hoisted(() => ({
  readCurrentFiledReturnsTargetReviewStorageState: vi.fn(),
  readFiledReturnsTargetReview: vi.fn(),
  persistFiledReturnsTargetReview: vi.fn(),
  resolveUnconfirmedFiledReturnsDownload: vi.fn(),
  readArtifactAcquisitionCheckpoints: vi.fn(),
  createMalformedArtifactAcquisitionCheckpointReference: vi.fn(),
  reconcileArtifactAcquisitionCheckpoint: vi.fn(),
  responseForFiledReturnsTargetReview: vi.fn(() => ({
    ok: true as const,
    flowStep: {
      connectorId: "gst" as const,
      scopeId: "gst-gstr2b-private-v0",
      state: "blocked" as const,
      safeSignals: ["retained-gstr2b-review"],
      safeMessage: "Synthetic retained review.",
    },
  })),
  startSinglePeriodFiledReturnsDownloadFlow: vi.fn(async (scope: FiledReturnsDownloadScope) => ({
    ok: true as const,
    flowStep: {
      connectorId: "gst" as const,
      scopeId: `started:${scope.returnType}:${scope.artifactType ?? "PDF"}`,
      state: "clicked" as const,
      safeSignals: ["new-target-started"],
      safeMessage: "Synthetic new target.",
    },
  })),
}));
const activeRunMocks = vi.hoisted(() => ({
  acquireFiledReturnsRun: vi.fn(),
  releaseFiledReturnsRun: vi.fn(),
  startFiledReturnsRunLeaseRenewal: vi.fn(),
}));

vi.mock("../../src/background/filed-returns-target-review", async (importOriginal) => ({
  ...(await importOriginal<typeof FiledReturnsTargetReviewModule>()),
  readCurrentFiledReturnsTargetReviewStorageState:
    mocks.readCurrentFiledReturnsTargetReviewStorageState,
  readFiledReturnsTargetReview: mocks.readFiledReturnsTargetReview,
  responseForFiledReturnsTargetReview: mocks.responseForFiledReturnsTargetReview,
  persistFiledReturnsTargetReview: mocks.persistFiledReturnsTargetReview,
  resolveUnconfirmedFiledReturnsDownload: mocks.resolveUnconfirmedFiledReturnsDownload,
}));
vi.mock("../../src/background/filed-returns-active-run", () => activeRunMocks);
vi.mock("../../src/background/artifact-acquisition-state", () => ({
  createMalformedArtifactAcquisitionCheckpointReference:
    mocks.createMalformedArtifactAcquisitionCheckpointReference,
  readArtifactAcquisitionCheckpoints: mocks.readArtifactAcquisitionCheckpoints,
  reconcileArtifactAcquisitionCheckpoint: mocks.reconcileArtifactAcquisitionCheckpoint,
}));
vi.mock("../../src/background/filed-returns-single-period-flow", () => ({
  startSinglePeriodFiledReturnsDownloadFlow: mocks.startSinglePeriodFiledReturnsDownloadFlow,
}));

import {
  startFiledReturnsDownloadFlow,
  startFreshFiledReturnsDownloadFlow,
} from "../../src/background/filed-returns-flow-runner";

const retainedScope = {
  artifactType: "PDF_AND_EXCEL",
  financialYear: "2026-27",
  period: "June",
  returnType: "GSTR-2B",
} as const satisfies FiledReturnsDownloadScope;

describe("filed returns retained target scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({
      state: "valid",
      review: { scope: retainedScope } as FiledReturnsTargetReview,
    });
    mocks.readFiledReturnsTargetReview.mockResolvedValue(null);
    mocks.readArtifactAcquisitionCheckpoints.mockResolvedValue([]);
    mocks.createMalformedArtifactAcquisitionCheckpointReference.mockResolvedValue(
      "synthetic-malformed-reference",
    );
    mocks.resolveUnconfirmedFiledReturnsDownload.mockResolvedValue({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-returns-target-cancelled"],
        safeMessage: "Synthetic cancellation.",
      },
    });
    activeRunMocks.acquireFiledReturnsRun.mockResolvedValue({ run: { id: "synthetic-run" } });
    activeRunMocks.releaseFiledReturnsRun.mockResolvedValue(undefined);
    activeRunMocks.startFiledReturnsRunLeaseRenewal.mockReturnValue(() => undefined);
  });

  it.each([
    ["GSTR-1 PDF", { artifactType: "PDF", returnType: "GSTR-1" }],
    ["GSTR-3B PDF", { artifactType: "PDF", returnType: "GSTR-3B" }],
    ["GSTR-2B JSON", { artifactType: "JSON", returnType: "GSTR-2B" }],
  ] as const)("blocks %s until a retained GSTR-2B review is resolved", async (_label, target) => {
    const scope = {
      ...target,
      financialYear: "2026-27",
      period: "June",
    } satisfies FiledReturnsDownloadScope;

    const response = await startFiledReturnsDownloadFlow(scope, {
      storageKeys: {},
    } as never);

    expect(mocks.responseForFiledReturnsTargetReview).toHaveBeenCalledOnce();
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowStep: { safeSignals: ["retained-gstr2b-review"] } });
  });

  it("returns a blocked reason when target-review storage cannot be read before a start", async () => {
    const requestedScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-3B",
    } as const satisfies FiledReturnsDownloadScope;
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockRejectedValueOnce(
      new Error("synthetic target-review read failure"),
    );

    const response = await startFiledReturnsDownloadFlow(requestedScope, {
      storageKeys: {},
    } as never);

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: ["filed-returns-target-review-storage-unavailable"],
        safeMessage:
          "Pack could not read saved target recovery and will not start another portal action.",
        state: "blocked",
        userAction: {
          canResume: true,
          message: "Try again after local recovery state is available.",
          type: "RETRY_PORTAL_GENERATION",
        },
      },
      flowSummary: {
        completedPeriods: [],
        currentPeriod: "June",
        scope: requestedScope,
        status: "blocked",
        totalPeriods: 1,
      },
    });
    expect(activeRunMocks.acquireFiledReturnsRun).not.toHaveBeenCalled();
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
  });

  it("keeps the retained review bound to its own GSTR-2B bundle target", async () => {
    const response = await startFiledReturnsDownloadFlow(retainedScope, {
      storageKeys: {},
    } as never);

    expect(mocks.responseForFiledReturnsTargetReview).toHaveBeenCalledOnce();
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowStep: { safeSignals: ["retained-gstr2b-review"] } });
  });

  it("surfaces a retained exact checkpoint before accepting a different target", async () => {
    const checkpointTarget = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    } as const satisfies FiledReturnsDownloadScope;
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({ state: "missing" });
    mocks.readArtifactAcquisitionCheckpoints.mockResolvedValue([
      { state: "target", target: checkpointTarget },
    ]);
    mocks.reconcileArtifactAcquisitionCheckpoint.mockResolvedValue({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
    });
    mocks.persistFiledReturnsTargetReview.mockResolvedValue({
      completedPeriods: [],
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-returns-target-review-required"],
        safeMessage: "Synthetic retained checkpoint.",
      },
      scope: checkpointTarget,
      status: "blocked",
      totalPeriods: 1,
    });

    const response = await startFiledReturnsDownloadFlow({ ...checkpointTarget, period: "June" }, {
      storageKeys: {},
    } as never);

    expect(mocks.persistFiledReturnsTargetReview).toHaveBeenCalledWith(
      checkpointTarget,
      expect.objectContaining({
        safeSignals: expect.arrayContaining([
          "artifact-acquisition-download-completed-unpersisted",
        ]),
      }),
      expect.anything(),
    );
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowSummary: { scope: checkpointTarget, status: "blocked" } });
  });

  it("blocks a malformed retained checkpoint instead of starting another target", async () => {
    const requestedScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-3B",
    } as const satisfies FiledReturnsDownloadScope;
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({ state: "missing" });
    const malformedKey = "pack.artifact-acquisition.v2.unsafe\nkey";
    mocks.readArtifactAcquisitionCheckpoints.mockResolvedValue([
      { key: malformedKey, state: "malformed" },
    ]);
    mocks.persistFiledReturnsTargetReview.mockResolvedValue({
      completedPeriods: [],
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-returns-target-review-required"],
        safeMessage: "Synthetic malformed checkpoint.",
      },
      scope: requestedScope,
      status: "blocked",
      totalPeriods: 1,
    });

    const response = await startFiledReturnsDownloadFlow(requestedScope, {
      storageKeys: {},
    } as never);

    expect(mocks.persistFiledReturnsTargetReview).toHaveBeenCalledWith(
      requestedScope,
      expect.objectContaining({ safeSignals: ["artifact-acquisition-checkpoint-malformed"] }),
      expect.anything(),
      { artifactAcquisitionMalformedCheckpointReference: "synthetic-malformed-reference" },
    );
    expect(mocks.createMalformedArtifactAcquisitionCheckpointReference).toHaveBeenCalledWith(
      malformedKey,
    );
    expect(mocks.persistFiledReturnsTargetReview.mock.calls[0]?.[3]).toEqual({
      artifactAcquisitionMalformedCheckpointReference: "synthetic-malformed-reference",
    });
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowSummary: { status: "blocked" } });
  });

  it("returns a blocked reason when retained checkpoint storage cannot be read", async () => {
    const requestedScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-3B",
    } as const satisfies FiledReturnsDownloadScope;
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({ state: "missing" });
    mocks.readArtifactAcquisitionCheckpoints.mockRejectedValueOnce(
      new Error("synthetic retained-checkpoint read failure"),
    );

    const response = await startFiledReturnsDownloadFlow(requestedScope, {
      storageKeys: {},
    } as never);

    expect(response).toMatchObject({
      flowSummary: {
        scope: requestedScope,
        status: "blocked",
        totalPeriods: 1,
      },
      flowStep: {
        safeSignals: ["artifact-acquisition-checkpoint-storage-unavailable"],
        state: "blocked",
        safeMessage:
          "Pack could not read retained local artifact recovery and will not start another portal action.",
        userAction: {
          canResume: true,
          message: "Try again after local recovery state is available.",
          type: "RETRY_PORTAL_GENERATION",
        },
      },
    });
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
  });

  it("does not scan retained checkpoints when another run already owns the start", async () => {
    const activeResponse = {
      ok: true as const,
      flowStep: {
        connectorId: "gst" as const,
        scopeId: "gst-filed-returns-private-v0",
        state: "blocked" as const,
        safeSignals: ["filed-returns-run-active"],
        safeMessage: "Synthetic active run.",
      },
    };
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({ state: "missing" });
    activeRunMocks.acquireFiledReturnsRun.mockResolvedValue({ response: activeResponse });

    await expect(
      startFiledReturnsDownloadFlow(
        { ...retainedScope, artifactType: "PDF", returnType: "GSTR-3B" },
        { storageKeys: {} } as never,
      ),
    ).resolves.toEqual(activeResponse);

    expect(mocks.readArtifactAcquisitionCheckpoints).not.toHaveBeenCalled();
    expect(mocks.persistFiledReturnsTargetReview).not.toHaveBeenCalled();
  });

  it("rescans retained recovery after discarding a different target review", async () => {
    const discardedScope = retainedScope;
    const laterScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    } as const satisfies FiledReturnsDownloadScope;
    mocks.readFiledReturnsTargetReview.mockResolvedValue({ scope: discardedScope });
    mocks.readArtifactAcquisitionCheckpoints.mockResolvedValue([
      { state: "target", target: laterScope },
    ]);
    mocks.reconcileArtifactAcquisitionCheckpoint.mockResolvedValue({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-unreconciled"],
    });
    mocks.persistFiledReturnsTargetReview.mockResolvedValue({
      completedPeriods: [],
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-returns-target-review-required"],
        safeMessage: "Synthetic later target.",
      },
      scope: laterScope,
      status: "blocked",
      totalPeriods: 1,
    });

    const response = await startFreshFiledReturnsDownloadFlow(
      {
        scope: { ...laterScope, period: "June" },
        recovery: { kind: "target-review", scope: discardedScope },
      },
      { storageKeys: {} } as never,
    );

    expect(mocks.resolveUnconfirmedFiledReturnsDownload).toHaveBeenCalledWith(
      discardedScope,
      "cancelled",
      expect.anything(),
    );
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowSummary: { scope: laterScope, status: "blocked" } });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsTargetReview,
} from "../../src/connectors/gst/filed-returns-contracts";
import type * as FiledReturnsTargetReviewModule from "../../src/background/filed-returns-target-review";

const mocks = vi.hoisted(() => ({
  readCurrentFiledReturnsTargetReviewStorageState: vi.fn(),
  persistFiledReturnsTargetReview: vi.fn(),
  readArtifactAcquisitionCheckpoints: vi.fn(),
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

vi.mock("../../src/background/filed-returns-target-review", async (importOriginal) => ({
  ...(await importOriginal<typeof FiledReturnsTargetReviewModule>()),
  readCurrentFiledReturnsTargetReviewStorageState:
    mocks.readCurrentFiledReturnsTargetReviewStorageState,
  responseForFiledReturnsTargetReview: mocks.responseForFiledReturnsTargetReview,
  persistFiledReturnsTargetReview: mocks.persistFiledReturnsTargetReview,
}));
vi.mock("../../src/background/artifact-acquisition-state", () => ({
  readArtifactAcquisitionCheckpoints: mocks.readArtifactAcquisitionCheckpoints,
  reconcileArtifactAcquisitionCheckpoint: mocks.reconcileArtifactAcquisitionCheckpoint,
}));
vi.mock("../../src/background/filed-returns-single-period-flow", () => ({
  startSinglePeriodFiledReturnsDownloadFlow: mocks.startSinglePeriodFiledReturnsDownloadFlow,
}));

import { startFiledReturnsDownloadFlow } from "../../src/background/filed-returns-flow-runner";

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
    mocks.readArtifactAcquisitionCheckpoints.mockResolvedValue([]);
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
    mocks.readArtifactAcquisitionCheckpoints.mockResolvedValue([{ state: "malformed" }]);
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
    );
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowSummary: { status: "blocked" } });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsTargetReview,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
  FULL_FISCAL_YEAR_PERIOD,
  getFiledReturnsFullFiscalYearPeriods,
} from "../../src/connectors/gst/filed-returns-scope";
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
const fullFiscalYearRunStateMocks = vi.hoisted(() => ({
  readMalformedLedgerState: vi.fn(),
  readPlanLedgersStorageState: vi.fn(),
  readRetainedPlanLedgers: vi.fn(),
}));
const allSupportedRunStateMocks = vi.hoisted(() => ({
  readAllSupportedPlanLedgersStorageState: vi.fn(),
}));
const allSupportedFlowMocks = vi.hoisted(() => ({
  restartCompletedAllSupportedFullFiscalYearPlan: vi.fn(),
  retryAllSupportedFullFiscalYearTarget: vi.fn(),
  startAllSupportedFullFiscalYearDownloadFlow: vi.fn(),
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
vi.mock(
  "../../src/background/filed-returns-full-fiscal-year-run-state",
  async (importOriginal) => ({
    ...(await importOriginal()),
    readMalformedLedgerState: fullFiscalYearRunStateMocks.readMalformedLedgerState,
    readPlanLedgersStorageState: fullFiscalYearRunStateMocks.readPlanLedgersStorageState,
    readRetainedPlanLedgers: fullFiscalYearRunStateMocks.readRetainedPlanLedgers,
  }),
);
vi.mock(
  "../../src/background/filed-returns-all-supported-full-fiscal-year-run-state",
  () => allSupportedRunStateMocks,
);
vi.mock(
  "../../src/background/filed-returns-all-supported-full-fiscal-year",
  async (importOriginal) => ({
    ...(await importOriginal()),
    restartCompletedAllSupportedFullFiscalYearPlan:
      allSupportedFlowMocks.restartCompletedAllSupportedFullFiscalYearPlan,
    retryAllSupportedFullFiscalYearTarget:
      allSupportedFlowMocks.retryAllSupportedFullFiscalYearTarget,
    startAllSupportedFullFiscalYearDownloadFlow:
      allSupportedFlowMocks.startAllSupportedFullFiscalYearDownloadFlow,
  }),
);
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
  retryAllSupportedFiledReturnsFullFiscalYearTarget,
  startAllSupportedFiledReturnsFullFiscalYearDownloadFlow,
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
    fullFiscalYearRunStateMocks.readPlanLedgersStorageState.mockResolvedValue({
      state: "valid",
      ledgers: [],
    });
    fullFiscalYearRunStateMocks.readMalformedLedgerState.mockResolvedValue(null);
    fullFiscalYearRunStateMocks.readRetainedPlanLedgers.mockResolvedValue([]);
    allSupportedRunStateMocks.readAllSupportedPlanLedgersStorageState.mockResolvedValue({
      state: "valid",
      ledgers: [],
    });
    allSupportedFlowMocks.restartCompletedAllSupportedFullFiscalYearPlan.mockResolvedValue({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-private-v0",
        state: "clicked",
        safeSignals: ["all-supported-plan-restarted"],
        safeMessage: "Synthetic all-supported plan restart.",
      },
    });
    allSupportedFlowMocks.startAllSupportedFullFiscalYearDownloadFlow.mockResolvedValue({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-private-v0",
        state: "clicked",
        safeSignals: ["all-supported-plan-started"],
        safeMessage: "Synthetic all-supported plan start.",
      },
    });
    allSupportedFlowMocks.retryAllSupportedFullFiscalYearTarget.mockResolvedValue({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-private-v0",
        state: "clicked",
        safeSignals: ["all-supported-target-retried"],
        safeMessage: "Synthetic all-supported target retry.",
      },
    });
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

  it("blocks an atomic start while an all-supported plan needs review", async () => {
    const requestedScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-3B",
    } as const satisfies FiledReturnsDownloadScope;
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({ state: "missing" });
    allSupportedRunStateMocks.readAllSupportedPlanLedgersStorageState.mockResolvedValue({
      state: "valid",
      ledgers: [{ status: "blocked" }],
    });

    const response = await startFiledReturnsDownloadFlow(requestedScope, {
      storageKeys: { allSupportedFullFiscalYearLedgerIndex: "all-supported-index" },
    } as never);

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["all-supported-full-fiscal-year-run-needs-action"],
      },
    });
    expect(activeRunMocks.acquireFiledReturnsRun).not.toHaveBeenCalled();
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
  });

  it("passes the bound completed ledger to the durable all-supported restart", async () => {
    // The restart request is bound to the displayed ledger. The worker owns
    // replacement persistence so the old root is never deleted in isolation.
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({ state: "missing" });
    const request = {
      kind: "all-supported-returns-full-fiscal-year",
      financialYear: "2026-27",
      ledgerId: "full-fiscal-year-abc123de",
    } as const;

    const response = await startAllSupportedFiledReturnsFullFiscalYearDownloadFlow(
      request,
      { storageKeys: {} } as never,
      { discardCompletedPlanRoot: true },
    );

    expect(
      allSupportedFlowMocks.restartCompletedAllSupportedFullFiscalYearPlan,
    ).toHaveBeenCalledExactlyOnceWith(request, expect.anything(), expect.any(Function));
    expect(
      allSupportedFlowMocks.startAllSupportedFullFiscalYearDownloadFlow,
    ).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowStep: { safeSignals: ["all-supported-plan-restarted"] } });
  });

  it("will not retry one all-supported target while a different saved root needs review", async () => {
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({ state: "missing" });
    allSupportedRunStateMocks.readAllSupportedPlanLedgersStorageState.mockResolvedValue({
      state: "valid",
      ledgers: [
        {
          status: "blocked",
          planRoot: {
            kind: "all-supported-returns-full-fiscal-year",
            financialYear: "2025-26",
          },
        },
      ],
    });

    const response = await retryAllSupportedFiledReturnsFullFiscalYearTarget(
      {
        financialYear: "2026-27",
        ledgerId: "full-fiscal-year-abc123de",
        targetId: "GSTR-3B:2026-27:June",
        expectedRevision: 4,
      },
      { storageKeys: { allSupportedFullFiscalYearLedgerIndex: "all-supported-index" } } as never,
    );

    expect(response).toMatchObject({
      flowStep: { safeSignals: ["all-supported-full-fiscal-year-run-needs-action"] },
    });
    expect(activeRunMocks.acquireFiledReturnsRun).not.toHaveBeenCalled();
    expect(allSupportedFlowMocks.retryAllSupportedFullFiscalYearTarget).not.toHaveBeenCalled();
  });

  it("rechecks retained recovery after acquiring the all-supported retry lease", async () => {
    const concurrentReview = {
      scope: retainedScope,
      safeSignals: ["retained-gstr2b-review"],
    } as FiledReturnsTargetReview;
    let recoveryReads = 0;
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockImplementation(() => {
      recoveryReads += 1;
      return Promise.resolve(
        recoveryReads === 1
          ? { state: "missing" as const }
          : { state: "valid" as const, review: concurrentReview },
      );
    });

    const response = await retryAllSupportedFiledReturnsFullFiscalYearTarget(
      {
        financialYear: "2026-27",
        ledgerId: "full-fiscal-year-abc123de",
        targetId: "GSTR-3B:2026-27:June",
        expectedRevision: 4,
      },
      { storageKeys: { allSupportedFullFiscalYearLedgerIndex: "all-supported-index" } } as never,
    );

    expect(activeRunMocks.acquireFiledReturnsRun).toHaveBeenCalledOnce();
    expect(mocks.responseForFiledReturnsTargetReview).toHaveBeenCalledWith(concurrentReview);
    expect(allSupportedFlowMocks.retryAllSupportedFullFiscalYearTarget).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowStep: { safeSignals: ["retained-gstr2b-review"] } });
  });

  it("does not let Start fresh discard another recovery while an all-supported plan needs review", async () => {
    const requestedScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-3B",
    } as const satisfies FiledReturnsDownloadScope;
    allSupportedRunStateMocks.readAllSupportedPlanLedgersStorageState.mockResolvedValue({
      state: "valid",
      ledgers: [{ status: "blocked" }],
    });

    const response = await startFreshFiledReturnsDownloadFlow(
      {
        scope: requestedScope,
        recovery: { kind: "target-review", scope: retainedScope },
      },
      { storageKeys: { allSupportedFullFiscalYearLedgerIndex: "all-supported-index" } } as never,
    );

    expect(response).toMatchObject({
      flowStep: { safeSignals: ["all-supported-full-fiscal-year-run-needs-action"] },
    });
    expect(mocks.readFiledReturnsTargetReview).not.toHaveBeenCalled();
    expect(activeRunMocks.acquireFiledReturnsRun).not.toHaveBeenCalled();
    expect(mocks.resolveUnconfirmedFiledReturnsDownload).not.toHaveBeenCalled();
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
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

  it("surfaces a retained checkpoint before replaying an all-supported target", async () => {
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

    const response = await retryAllSupportedFiledReturnsFullFiscalYearTarget(
      {
        financialYear: "2026-27",
        ledgerId: "full-fiscal-year-abc123de",
        targetId: "GSTR-3B:2026-27:June",
        expectedRevision: 4,
      },
      { storageKeys: { allSupportedFullFiscalYearLedgerIndex: "all-supported-index" } } as never,
    );

    expect(mocks.persistFiledReturnsTargetReview).toHaveBeenCalledWith(
      checkpointTarget,
      expect.objectContaining({
        safeSignals: expect.arrayContaining([
          "artifact-acquisition-download-completed-unpersisted",
        ]),
      }),
      expect.anything(),
    );
    expect(allSupportedFlowMocks.retryAllSupportedFullFiscalYearTarget).not.toHaveBeenCalled();
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

  it("derives blocked full-year fallback progress from eligible periods", async () => {
    const now = new Date("2026-08-26T00:00:00.000Z");
    const requestedScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    } as const satisfies FiledReturnsDownloadScope;
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({ state: "missing" });
    mocks.readArtifactAcquisitionCheckpoints.mockRejectedValueOnce(
      new Error("synthetic retained-checkpoint read failure"),
    );

    const response = await startFiledReturnsDownloadFlow(requestedScope, {
      now: () => now,
      storageKeys: {},
    } as never);

    expect(response).toMatchObject({
      flowSummary: {
        status: "blocked",
        totalPeriods: getFiledReturnsFullFiscalYearPeriods("2026-27", now).length,
      },
    });
    if (!response.ok || !("flowSummary" in response) || !response.flowSummary) {
      throw new Error("Expected blocked fallback summary.");
    }
    expect(response.flowSummary?.totalPeriods).not.toBe(12);
  });

  it.each([
    [
      "target-review metadata is malformed",
      () => {
        mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValueOnce({
          state: "malformed",
        });
      },
    ],
    [
      "target-review storage is unavailable",
      () => {
        mocks.readCurrentFiledReturnsTargetReviewStorageState.mockRejectedValueOnce(
          new Error("synthetic target-review read failure"),
        );
      },
    ],
    [
      "the plan index is malformed",
      () => {
        fullFiscalYearRunStateMocks.readPlanLedgersStorageState.mockResolvedValueOnce({
          state: "malformed",
        });
      },
    ],
    [
      "the legacy ledger is malformed",
      () => {
        fullFiscalYearRunStateMocks.readMalformedLedgerState.mockResolvedValueOnce({});
      },
    ],
  ])("derives %s full-year blocked progress from eligible periods", async (_label, arrange) => {
    const now = new Date("2026-08-26T00:00:00.000Z");
    const requestedScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    } as const satisfies FiledReturnsDownloadScope;
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({ state: "missing" });
    mocks.readArtifactAcquisitionCheckpoints.mockResolvedValue([]);
    arrange();

    const response = await startFiledReturnsDownloadFlow(requestedScope, {
      now: () => now,
      storageKeys: {},
    } as never);

    expect(response).toMatchObject({
      flowSummary: {
        status: "blocked",
        totalPeriods: getFiledReturnsFullFiscalYearPeriods("2026-27", now).length,
      },
    });
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

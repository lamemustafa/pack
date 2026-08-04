import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistFiledReturnsTargetReview,
  reconcileRetainedArtifactAcquisition,
  readCurrentFiledReturnsTargetReviewStorageState,
  resolveUnconfirmedFiledReturnsDownload,
  retryCompletedSinglePeriodZipCleanup,
} from "../../src/background/filed-returns-target-review";
import { persistFiledReturnsTargetDownloadId } from "../../src/background/filed-returns-target-download-attempt";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";
import { canonicalDurableSummaryMessage } from "../../src/connectors/gst/filed-returns-durable-status";
import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
  createSinglePeriodBundleLedger,
  markSinglePeriodBundleArtifactRunning,
  markSinglePeriodBundleArtifactStaged,
  markSinglePeriodBundleZipIntent,
} from "../../src/background/filed-returns-single-period-bundle-ledger";

const browserMocks = vi.hoisted(() => {
  const sessionValues: Record<string, unknown> = {};
  return {
    storage: {
      local: {
        get: vi.fn(async (_key?: unknown): Promise<Record<string, unknown>> => {
          void _key;
          return {};
        }),
        remove: vi.fn(async (_key?: unknown) => {
          void _key;
        }),
        set: vi.fn(async (_values: Record<string, unknown>) => {
          void _values;
        }),
      },
      session: {
        values: sessionValues,
        get: vi.fn(async (key: string) =>
          Object.hasOwn(sessionValues, key) ? { [key]: sessionValues[key] } : {},
        ),
        remove: vi.fn(async (key: string) => {
          delete sessionValues[key];
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(sessionValues, values);
        }),
      },
    },
  };
});
const zipMocks = vi.hoisted(() => ({
  discardSinglePeriodFiledReturnsZip: vi.fn(async () => ["single-period-opfs-cleared"]),
}));
const acquisitionMocks = vi.hoisted(() => ({
  clearArtifactAcquisitionCheckpoints: vi.fn(),
  clearArtifactAcquisitionCheckpointsAfterPersistedSummary: vi.fn(),
  clearMalformedArtifactAcquisitionCheckpoints: vi.fn(),
  inspectArtifactAcquisitionCheckpoint: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));
vi.mock("../../src/background/filed-returns-single-period-zip", () => zipMocks);
vi.mock("../../src/background/artifact-acquisition-state", () => acquisitionMocks);

describe("filed returns target review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.storage.local.get.mockImplementation(async (_key: unknown) => {
      void _key;
      return {};
    });
    browserMocks.storage.local.set.mockImplementation(async (_values: Record<string, unknown>) => {
      void _values;
    });
    browserMocks.storage.local.remove.mockResolvedValue(undefined);
    for (const key of Object.keys(browserMocks.storage.session.values)) {
      delete browserMocks.storage.session.values[key];
    }
    zipMocks.discardSinglePeriodFiledReturnsZip.mockResolvedValue(["single-period-opfs-cleared"]);
    acquisitionMocks.clearArtifactAcquisitionCheckpoints.mockResolvedValue({ state: "cleared" });
    acquisitionMocks.clearArtifactAcquisitionCheckpointsAfterPersistedSummary.mockResolvedValue(
      undefined,
    );
    acquisitionMocks.clearMalformedArtifactAcquisitionCheckpoints.mockResolvedValue(true);
  });

  it("records a manual observation without completing or clearing the unresolved target", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "target-review"
        ? {
            [key]: {
              schemaVersion: "1.0",
              targetId: "GSTR-3B:2025-26:March",
              status: "download-unconfirmed",
              scope: {
                financialYear: "2025-26",
                period: "March",
                returnType: "GSTR-3B",
              },
              safeSignals: ["browser-download-not-observed"],
              safeMessage: "No browser completion.",
              updatedAt: "2026-06-24T00:00:00.000Z",
            },
          }
        : {},
    );

    const response = await resolveUnconfirmedFiledReturnsDownload(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      "manually-observed",
      {
        storageKeys: {
          completion: "completion",
          targetReview: "target-review",
        },
        now: () => new Date("2026-06-24T00:00:05.000Z"),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      flowSummary: {
        status: "blocked",
        completedPeriods: [],
        totalPeriods: 1,
        updatedAt: "2026-06-24T00:00:05.000Z",
      },
    });
    expect(response).toMatchObject({
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-returns-target-manually-observed"]),
      },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        safeSignals: expect.arrayContaining(["filed-returns-target-manually-observed"]),
      }),
    });
    expect(browserMocks.storage.session.set).not.toHaveBeenCalled();
  });

  it("cancels retained acquisition recovery without marking the target downloaded", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B" as const,
    };
    const localValues: Record<string, unknown> = {
      "target-review": {
        revision: 1,
        safeMessage: "Pack retained unresolved artifact recovery.",
        safeSignals: ["artifact-acquisition-download-interrupted"],
        schemaVersion: "1.0",
        scope,
        status: "download-unconfirmed",
        targetId: "GSTR-2B:2025-26:May:PDF_AND_EXCEL",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.remove.mockImplementation(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete localValues[key];
    });

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(acquisitionMocks.clearArtifactAcquisitionCheckpoints).toHaveBeenCalledWith(scope, {
      discardCompleted: true,
    });
    expect(localValues["target-review"]).toBeUndefined();
    expect(response).toMatchObject({
      flowStep: { state: "user-action-required" },
      flowSummary: { completedPeriods: [], status: "cancelled" },
    });
    if (!response.ok || !("flowStep" in response))
      throw new Error("Expected a target resolution step.");
    expect(response.flowStep.safeSignals).not.toContain("single-period-zip-downloaded");
  });

  it("reconciles an evidenced acquisition completion without repeating its portal action", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-3B" as const,
    };
    const localValues: Record<string, unknown> = {
      "target-review": {
        revision: 1,
        safeMessage: "Pack retained unresolved artifact recovery.",
        safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
        schemaVersion: "1.0",
        scope,
        status: "download-unconfirmed",
        targetId: "GSTR-3B:2025-26:May",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(localValues, values);
    });
    browserMocks.storage.local.remove.mockImplementation(async (keys: unknown) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (typeof key === "string") delete localValues[key];
      }
    });
    acquisitionMocks.inspectArtifactAcquisitionCheckpoint.mockResolvedValue({
      state: "completed",
      evidence: {
        artifactType: "PDF",
        downloadId: 9,
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    });

    const response = await reconcileRetainedArtifactAcquisition(scope, {
      storageKeys: { completion: "completion", targetReview: "target-review" },
      now: () => new Date("2026-08-01T00:00:05.000Z"),
    });

    expect(response).toMatchObject({ flowSummary: { status: "complete" } });

    expect(
      parseDurableFiledReturnsFlowSummary(browserMocks.storage.session.values.completion),
    ).toMatchObject({
      completedPeriods: ["May"],
      flowStep: {
        safeSignals: expect.arrayContaining([
          "artifact-acquisition-download-reconciled",
          "browser-download-completed",
          "browser-download-id:9",
          "browser-download-non-empty",
        ]),
        state: "downloaded",
      },
      status: "complete",
    });
    expect(localValues["target-review"]).toBeUndefined();
    expect(
      acquisitionMocks.clearArtifactAcquisitionCheckpointsAfterPersistedSummary,
    ).toHaveBeenCalledWith(scope, [
      {
        artifactType: "PDF",
        downloadId: 9,
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    ]);
  });

  it("keeps a persisted acquisition completion when cleanup finishes before review removal", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-3B" as const,
    };
    const localValues: Record<string, unknown> = {
      "target-review": {
        revision: 1,
        safeMessage: "Pack retained unresolved artifact recovery.",
        safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
        schemaVersion: "1.0",
        scope,
        status: "download-unconfirmed",
        targetId: "GSTR-3B:2025-26:May",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(localValues, values);
    });
    browserMocks.storage.local.remove.mockImplementation(async (keys: unknown) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (typeof key === "string") delete localValues[key];
      }
    });
    acquisitionMocks.inspectArtifactAcquisitionCheckpoint.mockResolvedValueOnce({
      state: "completed",
      evidence: {
        artifactType: "PDF",
        downloadId: 9,
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    });
    acquisitionMocks.clearArtifactAcquisitionCheckpointsAfterPersistedSummary.mockRejectedValueOnce(
      new Error("simulated worker stop after checkpoint cleanup"),
    );

    await expect(
      reconcileRetainedArtifactAcquisition(scope, {
        storageKeys: { completion: "completion", targetReview: "target-review" },
      }),
    ).rejects.toThrow("simulated worker stop after checkpoint cleanup");

    expect(localValues["target-review"]).toMatchObject({
      artifactAcquisitionCompletion: [
        {
          artifactType: "PDF",
          downloadId: 9,
          requestId: "11111111-1111-4111-8111-111111111111",
        },
      ],
    });
    expect(
      parseDurableFiledReturnsFlowSummary(browserMocks.storage.session.values.completion),
    ).toMatchObject({
      artifactAcquisitionCompletion: [
        {
          artifactType: "PDF",
          downloadId: 9,
          requestId: "11111111-1111-4111-8111-111111111111",
        },
      ],
      status: "complete",
      completedPeriods: ["May"],
    });

    acquisitionMocks.clearArtifactAcquisitionCheckpoints.mockResolvedValueOnce({
      state: "cleared",
    });
    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(response).toMatchObject({
      flowSummary: { status: "complete", completedPeriods: ["May"] },
      flowStep: { state: "downloaded" },
    });
    expect(localValues["target-review"]).toBeUndefined();
    expect(
      parseDurableFiledReturnsFlowSummary(browserMocks.storage.session.values.completion),
    ).toMatchObject({ status: "complete", completedPeriods: ["May"] });
  });

  it("records a new same-scope cancellation instead of returning an earlier acquisition completion", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-3B" as const,
    };
    const localValues: Record<string, unknown> = {
      "target-review": {
        revision: 1,
        safeMessage: "Pack retained unresolved artifact recovery.",
        safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
        schemaVersion: "1.0",
        scope,
        status: "download-unconfirmed",
        targetId: "GSTR-3B:2025-26:May",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(localValues, values);
    });
    browserMocks.storage.local.remove.mockImplementation(async (keys: unknown) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (typeof key === "string") delete localValues[key];
      }
    });
    acquisitionMocks.inspectArtifactAcquisitionCheckpoint.mockResolvedValueOnce({
      state: "completed",
      evidence: {
        artifactType: "PDF",
        downloadId: 9,
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    });

    await reconcileRetainedArtifactAcquisition(scope, {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(
      parseDurableFiledReturnsFlowSummary(browserMocks.storage.session.values.completion),
    ).toMatchObject({
      artifactAcquisitionCompletion: [
        {
          artifactType: "PDF",
          downloadId: 9,
          requestId: "11111111-1111-4111-8111-111111111111",
        },
      ],
      status: "complete",
    });

    localValues["target-review"] = {
      revision: 1,
      safeMessage: "Pack retained a new unresolved artifact recovery.",
      safeSignals: ["artifact-acquisition-download-interrupted"],
      schemaVersion: "1.0",
      scope,
      status: "download-unconfirmed",
      targetId: "GSTR-3B:2025-26:May",
      updatedAt: "2026-08-01T00:01:00.000Z",
    };

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(response).toMatchObject({
      flowStep: { state: "user-action-required" },
      flowSummary: { completedPeriods: [], status: "cancelled" },
    });
    expect(localValues["target-review"]).toBeUndefined();
    expect(
      parseDurableFiledReturnsFlowSummary(browserMocks.storage.session.values.completion),
    ).toMatchObject({ completedPeriods: [], status: "cancelled" });
  });

  it("keeps direct PDF and Excel evidence unproved for a selected-file ZIP", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B" as const,
    };
    const localValues: Record<string, unknown> = {
      "target-review": {
        revision: 1,
        safeMessage: "Pack retained unresolved artifact recovery.",
        safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
        schemaVersion: "1.0",
        scope,
        status: "download-unconfirmed",
        targetId: "GSTR-2B:2025-26:May:PDF_AND_EXCEL",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(localValues, values);
    });
    browserMocks.storage.local.remove.mockImplementation(async (keys: unknown) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (typeof key === "string") delete localValues[key];
      }
    });
    acquisitionMocks.clearArtifactAcquisitionCheckpoints.mockResolvedValue({ state: "cleared" });

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(response).toMatchObject({
      flowSummary: { status: "cancelled", completedPeriods: [] },
      flowStep: {
        safeSignals: expect.arrayContaining(["filed-returns-target-cancelled"]),
        state: "user-action-required",
      },
    });
    expect(acquisitionMocks.clearArtifactAcquisitionCheckpoints).toHaveBeenCalledWith(scope, {
      discardCompleted: true,
    });
  });

  it("keeps retained acquisition recovery blocked when an exact download cannot be cancelled", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-3B" as const,
    };
    const review = {
      revision: 1,
      safeMessage: "Pack retained unresolved artifact recovery.",
      safeSignals: ["artifact-acquisition-download-unreconciled"],
      schemaVersion: "1.0",
      scope,
      status: "download-unconfirmed",
      targetId: "GSTR-3B:2025-26:May",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    browserMocks.storage.local.get.mockResolvedValue({ "target-review": review });
    acquisitionMocks.clearArtifactAcquisitionCheckpoints.mockResolvedValue({ state: "blocked" });

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "artifact-acquisition-download-unreconciled",
          "artifact-acquisition-checkpoint-clear-failed",
        ]),
        state: "user-action-required",
      },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        safeSignals: expect.arrayContaining(["artifact-acquisition-checkpoint-clear-failed"]),
      }),
    });
  });

  it("does not persist optional GSTR-1 Excel no-details as a timeout review", async () => {
    const summary = await persistFiledReturnsTargetReview(
      {
        artifactType: "EXCEL",
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-1",
      },
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "blocked",
        safeSignals: [
          "filed-gstr1-main-world-capture-timeout",
          "filed-gstr1-excel-no-details-available",
        ],
        safeMessage: "No e-invoice details are available.",
      },
      { storageKeys: { completion: "completion", targetReview: "target-review" } },
    );

    expect(summary).toBeNull();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("persists retained artifact acquisition recovery as a resolvable target review", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-3B" as const,
    };

    const summary = await persistFiledReturnsTargetReview(
      scope,
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        safeMessage: "Pack retained unresolved artifact download recovery.",
        safeSignals: ["artifact-acquisition-download-interrupted"],
        state: "blocked",
      },
      { storageKeys: { targetReview: "target-review" } },
    );

    expect(summary).toMatchObject({
      completedPeriods: [],
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-returns-target-review-required",
          "artifact-acquisition-download-interrupted",
        ]),
        state: "user-action-required",
      },
      status: "blocked",
    });
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        safeSignals: ["artifact-acquisition-download-interrupted"],
        status: "download-unconfirmed",
      }),
    });
  });

  it("persists browser danger rejection for explicit target review", async () => {
    const scope = {
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B" as const,
    };

    const summary = await persistFiledReturnsTargetReview(
      scope,
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "blocked",
        safeSignals: ["browser-download-danger-rejected"],
        safeMessage: "The browser did not classify this download as safe.",
      },
      { storageKeys: { targetReview: "target-review" } },
    );

    expect(summary).toMatchObject({
      status: "blocked",
      completedPeriods: [],
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-returns-target-review-required",
          "browser-download-danger-rejected",
        ]),
      },
    });
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        safeSignals: ["browser-download-danger-rejected"],
      }),
    });
  });

  it("replaces unknown durable status and free-form copy with a fail-closed review", async () => {
    const summary = await persistFiledReturnsTargetReview(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "download-unconfirmed",
        safeSignals: ["synthetic-taxpayer-status"],
        safeMessage: "Synthetic Taxpayer GSTIN 00XXXXX0000X0Z0 needs review.",
      },
      { storageKeys: { targetReview: "target-review" } },
    );

    expect(summary).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "filed-return-durable-status-rejected",
          "filed-returns-download-manual-review-required",
        ]),
      },
    });
    expect(summary?.flowStep.safeSignals).not.toContain(
      "filed-returns-download-reconciliation-required",
    );
    expect(summary?.flowStep.safeMessage).not.toContain("exact browser download");
    const stored = browserMocks.storage.local.set.mock.calls.at(-1)?.[0]?.["target-review"] as
      { safeMessage: string; safeSignals: string[] } | undefined;
    expect(stored).toMatchObject({
      safeSignals: ["filed-return-durable-status-rejected"],
    });
    expect(stored?.safeMessage).not.toContain("00XXXXX0000X0Z0");
    expect(stored?.safeMessage).not.toContain("Synthetic Taxpayer");
  });

  it("reconstructs durable copy and rejects duplicate or malformed recovery metadata", async () => {
    const review = {
      schemaVersion: "1.0",
      targetId: "GSTR-3B:2025-26:March",
      status: "download-unconfirmed",
      scope: { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
      safeSignals: ["browser-download-not-observed"],
      safeMessage: "Synthetic Taxpayer GSTIN 00XXXXX0000X0Z0 needs review.",
      updatedAt: "2026-06-24T00:00:00.000Z",
    };
    browserMocks.storage.local.get.mockResolvedValue({ "target-review": review });
    const state = await readCurrentFiledReturnsTargetReviewStorageState({
      storageKeys: { targetReview: "target-review" },
    });
    expect(state).toMatchObject({ state: "valid" });
    if (state.state === "valid") {
      expect(state.review.safeMessage).not.toContain("00XXXXX0000X0Z0");
    }
    const canonicalWrite = browserMocks.storage.local.set.mock.calls.at(-1)?.[0]?.[
      "target-review"
    ] as { safeMessage?: string } | undefined;
    expect(canonicalWrite?.safeMessage).not.toContain("00XXXXX0000X0Z0");
    expect(canonicalWrite?.safeMessage).not.toContain("Synthetic Taxpayer");

    for (const malformed of [
      {
        ...review,
        safeSignals: ["browser-download-not-observed", "browser-download-not-observed"],
      },
      { ...review, unexpectedPortalText: "Synthetic Taxpayer" },
      { ...review, updatedAt: "2026-06-24" },
      { ...review, scope: { ...review.scope, period: "Synthetic Taxpayer" } },
    ]) {
      browserMocks.storage.local.get.mockResolvedValueOnce({ "target-review": malformed });
      await expect(
        readCurrentFiledReturnsTargetReviewStorageState({
          storageKeys: { targetReview: "target-review" },
        }),
      ).resolves.toEqual({ state: "malformed" });
    }
    const malformedWrites = browserMocks.storage.local.set.mock.calls
      .map(([values]) => values["target-review"])
      .filter(
        (value): value is { schemaVersion: string; state: string } =>
          typeof value === "object" &&
          value !== null &&
          (value as { state?: unknown }).state === "malformed",
      );
    expect(malformedWrites).toEqual([
      { schemaVersion: "1.0", state: "malformed" },
      { schemaVersion: "1.0", state: "malformed" },
      { schemaVersion: "1.0", state: "malformed" },
      { schemaVersion: "1.0", state: "malformed" },
    ]);
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  it("replaces malformed recovery metadata before returning the fail-closed response", async () => {
    const localValues: Record<string, unknown> = {
      "target-review": {
        unexpectedPortalText: "Synthetic Taxpayer GSTIN 00XXXXX0000X0Z0",
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values) => {
      Object.assign(localValues, values);
    });

    const response = await resolveUnconfirmedFiledReturnsDownload(
      { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
      "cancelled",
      { storageKeys: { targetReview: "target-review" } },
    );

    expect(localValues["target-review"]).toEqual({ schemaVersion: "1.0", state: "malformed" });
    expect(response).toMatchObject({
      flowStep: { safeSignals: ["filed-returns-target-review-malformed"], state: "blocked" },
    });
    expect(JSON.stringify(response)).not.toContain("00XXXXX0000X0Z0");
  });

  it("retains bounded per-artifact evidence through restart and cleanup review updates", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    const pdf = diagnostic("PDF", "action-m0abc123-pdf00001");
    const excel = diagnostic("EXCEL", "action-m0abc123-excel001");
    const deps = { storageKeys: { targetReview: "target-review" } };

    const summary = await persistFiledReturnsTargetReview(
      scope,
      {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "download-unconfirmed",
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "The combined target needs review.",
        downloadDiagnostic: excel,
        downloadDiagnostics: [pdf, excel],
      },
      deps,
    );

    expect(summary?.flowStep).toMatchObject({
      downloadDiagnostic: excel,
      downloadDiagnostics: [pdf, excel],
    });
    const firstWrite = browserMocks.storage.local.set.mock.calls.at(-1)?.[0] as
      Record<string, unknown> | undefined;
    const storedReview = firstWrite?.["target-review"];
    browserMocks.storage.local.get.mockResolvedValue({ "target-review": storedReview });

    const cleanupSummary = await persistFiledReturnsTargetReview(
      scope,
      {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "blocked",
        safeSignals: ["single-period-opfs-clear-failed"],
        safeMessage: "Temporary staging cleanup failed.",
      },
      deps,
    );

    expect(cleanupSummary?.flowStep).toMatchObject({
      downloadDiagnostic: excel,
      downloadDiagnostics: [pdf, excel],
    });
  });

  it("treats sensitive-looking or mismatched persisted diagnostic metadata as malformed", async () => {
    const pdf = diagnostic("PDF", "action-m0abc123-pdf00001");
    browserMocks.storage.local.get.mockResolvedValue({
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-2B:2025-26:March:PDF_AND_EXCEL",
        status: "download-unconfirmed",
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-2B",
        },
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "The combined target needs review.",
        downloadDiagnostic: { ...pdf, rawUrl: "synthetic-forbidden" },
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    await expect(
      readCurrentFiledReturnsTargetReviewStorageState({
        storageKeys: { targetReview: "target-review" },
      }),
    ).resolves.toEqual({ state: "malformed" });
  });

  it("does not let manual review hide retained single-period staging", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    const review = {
      schemaVersion: "1.0",
      targetId: "GSTR-2B:2025-26:March:PDF_AND_EXCEL",
      status: "download-unconfirmed",
      scope,
      safeSignals: ["single-period-zip-download-unconfirmed", "single-period-opfs-clear-failed"],
      safeMessage: "The ZIP download was unconfirmed and staging cleanup failed.",
      updatedAt: "2026-06-24T00:00:00.000Z",
    };
    browserMocks.storage.local.get.mockResolvedValue({ "target-review": review });

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "manually-observed", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: [
          "filed-returns-target-review-required",
          "filed-returns-target-local-cleanup-required",
          "single-period-opfs-clear-failed",
          "single-period-opfs-cleanup-required",
        ],
      },
      flowSummary: { status: "blocked", completedPeriods: [] },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(browserMocks.storage.session.set).not.toHaveBeenCalled();
  });

  it("does not mark an incomplete selected-file ZIP complete manually", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    browserMocks.storage.local.get.mockResolvedValue({
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-2B:2025-26:March:PDF_AND_EXCEL",
        status: "download-unconfirmed",
        scope,
        safeSignals: ["gstr2b-main-world-capture-timeout", "single-period-zip-incomplete"],
        safeMessage: "The selected-file ZIP is incomplete.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "manually-observed", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: [
          "filed-returns-target-review-required",
          "filed-returns-target-manually-observed",
          "single-period-zip-incomplete",
          "gstr2b-main-world-capture-timeout",
        ],
        state: "user-action-required",
      },
      flowSummary: { status: "blocked" },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(browserMocks.storage.session.set).not.toHaveBeenCalled();
  });

  it("persists a cleanup-only target review for a cleanup-failed ZIP", async () => {
    const summary = await persistFiledReturnsTargetReview(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-2B",
      },
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
        state: "download-unconfirmed",
        safeSignals: ["single-period-zip-download-unconfirmed", "single-period-opfs-clear-failed"],
        safeMessage: "Cleanup failed.",
      },
      { storageKeys: { targetReview: "target-review" } },
    );

    expect(summary).toMatchObject({
      status: "blocked",
      flowStep: {
        safeSignals: [
          "filed-returns-target-review-required",
          "filed-returns-target-local-cleanup-required",
          "single-period-opfs-clear-failed",
          "single-period-opfs-cleanup-required",
        ],
      },
    });
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        safeSignals: expect.arrayContaining(["single-period-opfs-clear-failed"]),
      }),
    });
    expect(parseDurableFiledReturnsFlowSummary(summary)?.flowStep.safeMessage).toBe(
      "Pack cannot complete this review while temporary selected-file staging remains uncleared.",
    );
  });

  it("never renders a confirmed ZIP cleanup failure as an unverified download", async () => {
    const summary = await persistFiledReturnsTargetReview(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-2B",
      },
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
        state: "blocked",
        safeSignals: [
          "single-period-zip-downloaded",
          "single-period-opfs-clear-failed",
          "single-period-opfs-clear-error:clear-failed",
          "single-period-opfs-retained",
          "browser-download-completed",
          "browser-download-id:178",
          "browser-download-non-empty",
        ],
        safeMessage: "The synthetic ZIP completed before cleanup failed.",
      },
      {
        now: () => new Date("2026-07-29T00:00:00.000Z"),
        storageKeys: { targetReview: "target-review" },
      },
    );
    const durableSummary = parseDurableFiledReturnsFlowSummary(summary);

    expect(durableSummary).toMatchObject({
      status: "blocked",
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "filed-returns-target-review-required",
          "filed-returns-target-local-cleanup-required",
          "single-period-zip-downloaded",
          "single-period-opfs-clear-failed",
          "single-period-opfs-clear-error:clear-failed",
          "single-period-opfs-cleanup-required",
          "browser-download-completed",
          "browser-download-id:178",
          "browser-download-non-empty",
        ]),
        safeMessage:
          "Pack confirmed the selected ZIP download for April; only temporary local staging remains to be cleared.",
        userAction: { canResume: true },
      },
    });
    expect(durableSummary?.flowStep.safeMessage).not.toContain("could not verify");
  });

  it("keeps a cleanup-without-download review unresolved after staging is cleared", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    const review = {
      ...intentOnlyZipReview(scope),
      safeSignals: ["single-period-zip-download-unconfirmed", "single-period-opfs-clear-failed"],
    };
    const localValues: Record<string, unknown> = {
      "pack:single-period-staging": intentBundleLedger(scope),
      "target-review": review,
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values) => {
      Object.assign(localValues, values);
    });
    browserMocks.storage.local.remove.mockImplementation(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete localValues[key];
    });
    zipMocks.discardSinglePeriodFiledReturnsZip.mockResolvedValue(["single-period-opfs-cleared"]);

    const response = await retryCompletedSinglePeriodZipCleanup(scope, {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(response).toMatchObject({
      flowStep: { state: "user-action-required" },
      flowSummary: { completedPeriods: [], status: "blocked" },
    });
    expect(localValues["target-review"]).toMatchObject({
      safeSignals: expect.arrayContaining([
        "single-period-opfs-cleanup-completed",
        "single-period-zip-cleanup-without-download",
      ]),
    });
    expect(localValues["completion"]).toBeUndefined();
  });

  it("does not treat completed cleanup checkpoints as a cleanup failure", () => {
    expect(
      canonicalDurableSummaryMessage(
        {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-2B",
        },
        "complete",
        ["single-period-cleanup-checkpoints-cleared"],
      ),
    ).toBe("Pack completed the local filed-return download for April.");
  });

  it("does not render a confirmed fiscal-year ZIP cleanup failure as unconfirmed", () => {
    expect(
      canonicalDurableSummaryMessage(
        {
          financialYear: "2026-27",
          period: "FULL_FISCAL_YEAR",
          returnType: "GSTR-3B",
        },
        "blocked",
        [
          "full-fiscal-year-zip-downloaded",
          "full-fiscal-year-zip-cleanup-pending",
          "full-fiscal-year-opfs-clear-failed",
          "full-fiscal-year-opfs-retained",
        ],
      ),
    ).toBe(
      "Pack confirmed the final fiscal-year ZIP download; only retained local staging remains to be cleared.",
    );
  });

  it.each([
    ["multiple browser IDs", ["browser-download-id:179"]],
    ["zero-byte contradiction", ["browser-download-zero-bytes"]],
    ["correlation contradiction", ["browser-download-correlation-rejected"]],
  ])("does not claim confirmed ZIP evidence with %s", (_label, contradictorySignals) => {
    const message = canonicalDurableSummaryMessage(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-2B",
      },
      "blocked",
      [
        "filed-returns-target-review-required",
        "single-period-zip-downloaded",
        "single-period-opfs-clear-failed",
        "single-period-opfs-cleanup-required",
        "browser-download-completed",
        "browser-download-id:178",
        "browser-download-non-empty",
        ...contradictorySignals,
      ],
    );

    expect(message).toBe(
      "Pack cannot complete this review while temporary selected-file staging remains uncleared.",
    );
    expect(message).not.toContain("confirmed the selected ZIP download");
  });

  it("clears selected-file staging before cancelling an intent-only ZIP", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    const localValues: Record<string, unknown> = {
      "pack:single-period-staging": intentBundleLedger(scope),
      "target-review": intentOnlyZipReview(scope),
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(zipMocks.discardSinglePeriodFiledReturnsZip).toHaveBeenCalledWith(
      "single-period:cccccccccccccccccccc",
    );
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("target-review");
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("pack:single-period-staging");
    expect(response).toMatchObject({
      flowStep: {
        safeSignals: ["filed-returns-target-cancelled", "single-period-opfs-cleared"],
      },
      flowSummary: { completedPeriods: [], status: "cancelled" },
    });
  });

  it("clears the exact interrupted bundle when cancelling a review without a ZIP attempt", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    const ledger = runningBundleLedger(scope);
    const localValues: Record<string, unknown> = {
      "pack:single-period-staging": ledger,
      "target-review": interruptedBundleReview(scope),
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values) => {
      Object.assign(localValues, values);
    });
    browserMocks.storage.local.remove.mockImplementation(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete localValues[key];
    });

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(zipMocks.discardSinglePeriodFiledReturnsZip).toHaveBeenCalledWith(ledger.ledgerId);
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("pack:single-period-staging");
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("target-review");
    expect(localValues["pack:single-period-staging"]).toBeUndefined();
    expect(localValues["target-review"]).toBeUndefined();
    expect(response).toMatchObject({
      flowStep: {
        safeSignals: ["filed-returns-target-cancelled", "single-period-opfs-cleared"],
      },
      flowSummary: { completedPeriods: [], status: "cancelled" },
    });
  });

  it("rejects cancellation when the interrupted review revision does not match the bundle", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    const ledger = runningBundleLedger(scope);
    const review = interruptedBundleReview(scope);
    review.singlePeriodBundleCheckpoint.revision = ledger.revision - 1;
    const localValues: Record<string, unknown> = {
      "pack:single-period-staging": ledger,
      "target-review": review,
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values) => {
      Object.assign(localValues, values);
    });

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(zipMocks.discardSinglePeriodFiledReturnsZip).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(localValues["pack:single-period-staging"]).toEqual(ledger);
    expect(localValues["target-review"]).toMatchObject({
      singlePeriodBundleCheckpoint: review.singlePeriodBundleCheckpoint,
      safeSignals: expect.arrayContaining([
        "single-period-zip-cancel-cleanup-failed",
        "single-period-bundle-revision-conflict",
        "single-period-opfs-retained",
      ]),
    });
    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-returns-target-local-cleanup-required",
          "single-period-opfs-cleanup-required",
        ]),
        state: "blocked",
      },
    });
  });

  it("retains an interrupted bundle and exposes local cleanup retry when OPFS clear fails", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    const ledger = runningBundleLedger(scope);
    const localValues: Record<string, unknown> = {
      "pack:single-period-staging": ledger,
      "target-review": interruptedBundleReview(scope),
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      typeof key === "string" && Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values) => {
      Object.assign(localValues, values);
    });
    browserMocks.storage.local.remove.mockImplementation(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete localValues[key];
    });
    zipMocks.discardSinglePeriodFiledReturnsZip.mockResolvedValue([
      "single-period-opfs-clear-failed",
    ]);

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(localValues["pack:single-period-staging"]).toEqual(ledger);
    expect(localValues["target-review"]).toMatchObject({
      safeSignals: expect.arrayContaining([
        "single-period-zip-cancel-cleanup-failed",
        "single-period-opfs-clear-failed",
        "single-period-opfs-retained",
      ]),
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-returns-target-review-required",
          "filed-returns-target-local-cleanup-required",
          "single-period-opfs-cleanup-required",
        ]),
        state: "blocked",
      },
      flowSummary: { status: "blocked" },
    });

    zipMocks.discardSinglePeriodFiledReturnsZip.mockResolvedValue(["single-period-opfs-cleared"]);
    const cleanupResponse = await retryCompletedSinglePeriodZipCleanup(scope, {
      storageKeys: { completion: "completion", targetReview: "target-review" },
    });

    expect(cleanupResponse).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-returns-target-cancelled",
          "single-period-opfs-cleanup-completed",
          "single-period-opfs-cleared",
        ]),
      },
      flowSummary: { completedPeriods: [], status: "cancelled" },
    });
    expect(localValues["pack:single-period-staging"]).toBeUndefined();
    expect(localValues["target-review"]).toBeUndefined();
  });

  it("retains the ZIP checkpoint when cancellation staging cleanup fails", async () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B" as const,
    };
    const review = intentOnlyZipReview(scope);
    browserMocks.storage.local.get.mockResolvedValue({ "target-review": review });
    zipMocks.discardSinglePeriodFiledReturnsZip.mockResolvedValue([
      "single-period-opfs-clear-failed",
    ]);

    const response = await resolveUnconfirmedFiledReturnsDownload(scope, "cancelled", {
      storageKeys: { targetReview: "target-review" },
    });

    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "target-review": expect.objectContaining({
        downloadAttempt: review.downloadAttempt,
        safeSignals: expect.arrayContaining([
          "single-period-zip-cancel-cleanup-failed",
          "single-period-opfs-clear-failed",
          "single-period-opfs-retained",
        ]),
      }),
    });
    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-returns-target-review-required",
          "single-period-opfs-cleanup-required",
        ]),
        state: "blocked",
      },
    });
  });

  it("serializes a manual observation with exact download-ID attachment", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B" as const,
    };
    let storedReview = {
      downloadAttempt: {
        actionId: "action-m0abc123-marchpdf",
        artifactType: "PDF" as const,
        kind: "single-artifact" as const,
        phase: "download-intent-persisted" as const,
        requestedAt: "2026-06-24T00:00:00.000Z",
      },
      revision: 1,
      safeMessage: "Pack saved the target-bound download intent.",
      safeSignals: ["filed-returns-download-intent-persisted"],
      schemaVersion: "1.0" as const,
      scope,
      status: "download-unconfirmed" as const,
      targetId: "GSTR-3B:2025-26:March",
      updatedAt: "2026-06-24T00:00:00.000Z",
    };
    let releaseManualWrite: () => void = () => undefined;
    const manualWriteGate = new Promise<void>((resolve) => {
      releaseManualWrite = resolve;
    });
    let markManualWriteStarted: () => void = () => undefined;
    const manualWriteStarted = new Promise<void>((resolve) => {
      markManualWriteStarted = resolve;
    });
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "target-review" ? { "target-review": structuredClone(storedReview) } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      const nextReview = values["target-review"] as typeof storedReview | undefined;
      if (!nextReview) return;
      if (nextReview.safeSignals.includes("filed-returns-target-manually-observed")) {
        markManualWriteStarted();
        await manualWriteGate;
      }
      storedReview = structuredClone(nextReview);
    });
    const deps = {
      now: () => new Date("2026-06-24T00:00:05.000Z"),
      storageKeys: { targetReview: "target-review" },
    };

    const manualObservation = resolveUnconfirmedFiledReturnsDownload(
      scope,
      "manually-observed",
      deps,
    );
    await manualWriteStarted;
    const exactIdAttachment = persistFiledReturnsTargetDownloadId(scope, 81, deps);
    await Promise.resolve();
    expect(storedReview.downloadAttempt.phase).toBe("download-intent-persisted");

    releaseManualWrite();
    await expect(manualObservation).resolves.toMatchObject({ ok: true });
    await expect(exactIdAttachment).resolves.toBe(true);
    expect(storedReview).toMatchObject({
      revision: 3,
      safeSignals: expect.arrayContaining(["filed-returns-target-manually-observed"]),
      downloadAttempt: {
        actionId: "action-m0abc123-marchpdf",
        artifactType: "PDF",
        downloadId: 81,
        kind: "single-artifact",
        phase: "download-observing",
      },
    });
  });
});

function diagnostic(
  artifactType: "PDF" | "JSON" | "EXCEL",
  actionId: string,
): FiledReturnsDownloadDiagnostic {
  return {
    schemaVersion: "1.0",
    eventType: "filed-return-download-path",
    actionId,
    returnType: "GSTR-2B",
    financialYear: "2025-26",
    period: "March",
    endpointClass: "gstr2b-portal-blob-captured-download",
    artifactType,
    downloadPathClass: "captured-portal-request-blob",
    downloadId: artifactType === "PDF" ? 41 : artifactType === "JSON" ? 43 : 42,
    status: artifactType === "PDF" ? "downloaded" : "download-unconfirmed",
    mimeClass: artifactType === "PDF" ? "pdf" : artifactType === "JSON" ? "json" : "spreadsheet",
    byteCountClass: artifactType === "PDF" ? "non-empty" : "unknown",
  };
}

function interruptedBundleReview(scope: {
  artifactType: "PDF_AND_EXCEL";
  financialYear: string;
  period: string;
  returnType: "GSTR-2B";
}) {
  const ledger = runningBundleLedger(scope);
  return {
    revision: 1,
    safeMessage: "Pack retained an interrupted selected-file bundle.",
    safeSignals: [
      "single-period-bundle-artifact-review-required",
      "single-period-bundle-running-ambiguous",
      "single-period-opfs-retained",
    ],
    schemaVersion: "1.0" as const,
    singlePeriodBundleCheckpoint: {
      ledgerId: ledger.ledgerId,
      revision: ledger.revision,
    },
    scope,
    status: "download-unconfirmed" as const,
    targetId: "GSTR-2B:2025-26:March:PDF_AND_EXCEL",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}

function runningBundleLedger(scope: FiledReturnsDownloadScope) {
  const created = createSinglePeriodBundleLedger(
    scope,
    "single-period:bbbbbbbbbbbbbbbbbbbb",
    new Date("2026-06-23T23:59:55.000Z"),
  )!;
  return markSinglePeriodBundleArtifactRunning(
    created,
    "PDF",
    new Date("2026-06-23T23:59:56.000Z"),
  )!;
}

function intentOnlyZipReview(scope: {
  artifactType: "PDF_AND_EXCEL";
  financialYear: string;
  period: string;
  returnType: "GSTR-2B";
}) {
  return {
    downloadAttempt: {
      artifactType: "ZIP" as const,
      kind: "single-period-zip" as const,
      phase: "download-intent-persisted" as const,
      requestedAt: "2026-06-24T00:00:00.000Z",
      stagingLedgerId: "single-period:cccccccccccccccccccc",
    },
    schemaVersion: "1.0" as const,
    targetId: "GSTR-2B:2025-26:March:PDF_AND_EXCEL",
    status: "download-unconfirmed" as const,
    scope,
    safeSignals: ["filed-returns-download-intent-persisted", "single-period-opfs-retained"],
    safeMessage: "Pack saved the ZIP intent checkpoint.",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}

function intentBundleLedger(scope: FiledReturnsDownloadScope) {
  const created = createSinglePeriodBundleLedger(
    scope,
    "single-period:cccccccccccccccccccc",
    new Date("2026-06-23T23:59:55.000Z"),
  )!;
  const pdfRunning = markSinglePeriodBundleArtifactRunning(
    created,
    "PDF",
    new Date("2026-06-23T23:59:56.000Z"),
  )!;
  const pdfStaged = markSinglePeriodBundleArtifactStaged(
    pdfRunning,
    "PDF",
    stagedBundleStep(scope, "PDF"),
    new Date("2026-06-23T23:59:57.000Z"),
  )!;
  const excelRunning = markSinglePeriodBundleArtifactRunning(
    pdfStaged,
    "EXCEL",
    new Date("2026-06-23T23:59:58.000Z"),
  )!;
  const ready = markSinglePeriodBundleArtifactStaged(
    excelRunning,
    "EXCEL",
    stagedBundleStep(scope, "EXCEL"),
    new Date("2026-06-23T23:59:59.000Z"),
  )!;
  if (scope.returnType !== "GSTR-2B") {
    return markSinglePeriodBundleZipIntent(ready, new Date("2026-06-24T00:00:00.000Z"))!;
  }
  const jsonRunning = markSinglePeriodBundleArtifactRunning(
    ready,
    "JSON",
    new Date("2026-06-24T00:00:00.000Z"),
  )!;
  const jsonStaged = markSinglePeriodBundleArtifactStaged(
    jsonRunning,
    "JSON",
    stagedBundleStep(scope, "JSON"),
    new Date("2026-06-24T00:00:01.000Z"),
  )!;
  return markSinglePeriodBundleZipIntent(jsonStaged, new Date("2026-06-24T00:00:02.000Z"))!;
}

function stagedBundleStep(
  scope: FiledReturnsDownloadScope,
  artifactType: "PDF" | "JSON" | "EXCEL",
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    downloadDiagnostic: {
      ...diagnostic(
        artifactType,
        artifactType === "PDF"
          ? "action-m0abc123-pdf00001"
          : artifactType === "JSON"
            ? "action-m0abc123-json0001"
            : "action-m0abc123-excel001",
      ),
      byteCountClass: "non-empty",
      downloadId: artifactType === "PDF" ? 51 : 52,
      mimeClass: artifactType === "PDF" ? "pdf" : artifactType === "JSON" ? "json" : "spreadsheet",
      status: "downloaded",
      financialYear: scope.financialYear,
      period: scope.period,
      returnType: scope.returnType,
    },
    safeMessage: "The exact synthetic artifact was staged.",
    safeSignals: [
      `filed-return-artifact-downloaded:${artifactType}`,
      "single-period-opfs-staged",
      `single-period-opfs-staged:${artifactType}`,
    ],
    scopeId: "gst-filed-returns-private-v0",
    state: "downloaded",
  };
}

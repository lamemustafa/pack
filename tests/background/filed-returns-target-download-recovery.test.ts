import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadScope,
  FiledReturnsTargetDownloadAttempt,
  FiledReturnsTargetReview,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import type { SafeDownloadObservation } from "../../src/background/download-observer";

const mocks = vi.hoisted(() => {
  const state = {
    failTargetReviewRemoveOnce: false,
    local: {} as Record<string, unknown>,
    session: {} as Record<string, unknown>,
  };
  const events: string[] = [];
  const localSet = vi.fn(async (values: Record<string, unknown>) => {
    const review = values["target-review"] as FiledReturnsTargetReview | undefined;
    if (review?.downloadAttempt?.phase === "download-intent-persisted") {
      events.push("storage:intent");
    }
    if (review?.downloadAttempt?.phase === "download-observing") {
      events.push("storage:observing");
    }
    Object.assign(state.local, values);
  });
  const localRemove = vi.fn(async (key: string) => {
    if (key === "target-review") events.push("storage:review-clear-attempt");
    if (key === "pack:single-period-staging") events.push("storage:staging-clear");
    if (key === "target-review" && state.failTargetReviewRemoveOnce) {
      state.failTargetReviewRemoveOnce = false;
      throw new Error("Synthetic target-review cleanup failure.");
    }
    delete state.local[key];
  });
  const sessionSet = vi.fn(async (values: Record<string, unknown>) => {
    if (values.completion) events.push("storage:completion");
    Object.assign(state.session, values);
  });
  const downloadsDownload = vi.fn(async () => {
    events.push("download");
    return 41;
  });
  const observeBrowserDownloadById = vi.fn<
    (...args: unknown[]) => Promise<SafeDownloadObservation>
  >(async () => {
    events.push("observe");
    return {
      state: "completed" as const,
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "The exact synthetic download completed.",
      safeEvidence: {
        byteCountClass: "non-empty" as const,
        downloadId: 41,
        mimeClass: "pdf" as const,
        urlClass: "blob" as const,
      },
    };
  });

  return {
    browser: {
      downloads: {
        download: downloadsDownload,
        search: vi.fn(async () => [] as unknown[]),
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) =>
            Object.prototype.hasOwnProperty.call(state.local, key)
              ? { [key]: state.local[key] }
              : {},
          ),
          remove: localRemove,
          set: localSet,
        },
        session: {
          get: vi.fn(async (key: string) =>
            Object.prototype.hasOwnProperty.call(state.session, key)
              ? { [key]: state.session[key] }
              : {},
          ),
          remove: vi.fn(async (key: string) => {
            delete state.session[key];
          }),
          set: sessionSet,
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => undefined),
      },
    },
    discardSinglePeriodFiledReturnsZip: vi.fn(async () => ["single-period-opfs-cleared"]),
    events,
    observeBrowserDownloadById,
    state,
  };
});

vi.mock("wxt/browser", () => ({ browser: mocks.browser }));
vi.mock("../../src/background/download-observer", async (importOriginal) => ({
  ...(await importOriginal()),
  observeBrowserDownloadById: mocks.observeBrowserDownloadById,
}));
vi.mock("../../src/background/filed-returns-single-period-zip", () => ({
  discardSinglePeriodFiledReturnsZip: mocks.discardSinglePeriodFiledReturnsZip,
}));
vi.mock("../../src/background/offscreen-blob-url", () => ({
  closeOffscreenBlobDocument: vi.fn(async () => undefined),
  createOffscreenBlobUrl: vi.fn(async () => "blob:chrome-extension://pack/synthetic-file"),
  revokeOffscreenBlobUrl: vi.fn(async () => undefined),
}));

import { reconcileFiledReturnsTargetDownload } from "../../src/background/filed-returns-target-download-recovery";
import { persistReconciledZipCleanupCheckpoint } from "../../src/background/filed-returns-target-download-recovery";
import { isFiledReturnsTargetDownloadAttempt } from "../../src/background/filed-returns-target-download-attempt-validation";
import {
  createSinglePeriodBundleLedger,
  markSinglePeriodBundleArtifactRunning,
  markSinglePeriodBundleArtifactStaged,
  markSinglePeriodBundleZipDownloadId,
  markSinglePeriodBundleZipIntent,
  singlePeriodBundleFlowStep,
} from "../../src/background/filed-returns-single-period-bundle-ledger";
import { cleanupSinglePeriodBundleStaging } from "../../src/background/filed-returns-single-period-bundle-cleanup";
import { singlePeriodCleanupCheckpointFailureSignal } from "../../src/connectors/gst/single-period-cleanup-checkpoint";
import {
  readFiledReturnsTargetReview,
  resolveUnconfirmedFiledReturnsDownload,
  retryCompletedSinglePeriodZipCleanup,
} from "../../src/background/filed-returns-target-review";

const REVIEW_KEY = "target-review";
const COMPLETION_KEY = "completion";
const NOW = new Date("2026-07-24T00:00:00.000Z");
const REQUESTED_AT = "2026-07-23T23:59:00.000Z";

const PDF_SCOPE = {
  artifactType: "PDF",
  financialYear: "2026-27",
  period: "April",
  returnType: "GSTR-3B",
} satisfies FiledReturnsDownloadScope;

const ZIP_SCOPE = {
  artifactType: "PDF_AND_EXCEL",
  financialYear: "2026-27",
  period: "April",
  returnType: "GSTR-2B",
} satisfies FiledReturnsDownloadScope;

const deps = {
  storageKeys: {
    completion: COMPLETION_KEY,
    targetReview: REVIEW_KEY,
  },
  now: () => NOW,
};

describe("filed returns target download recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.state.failTargetReviewRemoveOnce = false;
    mocks.state.local = {};
    mocks.state.session = {};
    mocks.browser.storage.local.get.mockImplementation(async (key: string) =>
      Object.prototype.hasOwnProperty.call(mocks.state.local, key)
        ? { [key]: mocks.state.local[key] }
        : {},
    );
    mocks.browser.downloads.search.mockResolvedValue([]);
    mocks.browser.downloads.download.mockImplementation(async () => {
      mocks.events.push("download");
      return 41;
    });
    mocks.discardSinglePeriodFiledReturnsZip.mockImplementation(async () => {
      mocks.events.push("opfs:clear");
      return ["single-period-opfs-cleared"];
    });
    mocks.observeBrowserDownloadById.mockImplementation(async () => {
      mocks.events.push("observe");
      return completedObservation(41, "pdf");
    });
  });

  it.each(["url", "path", "filename"] as const)(
    "rejects a persisted attempt containing an extra %s field",
    async (unsafeKey) => {
      const unsafeAttempt = {
        ...observingArtifactAttempt(41),
        [unsafeKey]: `synthetic-${unsafeKey}`,
      };
      expect(isFiledReturnsTargetDownloadAttempt(unsafeAttempt)).toBe(false);
      mocks.state.local[REVIEW_KEY] = reviewFor(PDF_SCOPE, unsafeAttempt as never);

      await expect(readFiledReturnsTargetReview(PDF_SCOPE, deps)).resolves.toBeNull();
    },
  );

  it.each([REQUESTED_AT, "2026-07-23T23:59:30.001Z", "2026-07-23T23:59:30Z"])(
    "rejects an invalid provisional candidate window ending at %s",
    (candidateWindowEndsAt) => {
      expect(
        isFiledReturnsTargetDownloadAttempt({
          ...targetBoundCandidateAttempt(41),
          candidateWindowEndsAt,
        }),
      ).toBe(false);
    },
  );

  it.each([
    { label: "a SHA-256 digest", value: "a".repeat(64), valid: true },
    {
      label: "a raw extension Blob URL",
      value: "blob:chrome-extension://pack-id/synthetic",
      valid: false,
    },
    { label: "a raw portal URL", value: "https://return.gst.gov.in/synthetic", valid: false },
  ])("accepts only $label as a persisted selected-ZIP correlation value", ({ value, valid }) => {
    expect(
      isFiledReturnsTargetDownloadAttempt({
        artifactType: "ZIP",
        extensionBlobUrlFingerprint: value,
        kind: "single-period-zip",
        phase: "download-intent-persisted",
        requestedAt: REQUESTED_AT,
        stagingLedgerId: "single-period:dddddddddddddddddddd",
      }),
    ).toBe(valid);
  });

  it("keeps an interrupted provisional target-bound candidate manual and never reconciles it", async () => {
    const diagnostic = targetBoundPortalDiagnostic(41);
    const review = {
      ...reviewFor(PDF_SCOPE, targetBoundCandidateAttempt(41)),
      downloadDiagnostic: diagnostic,
      downloadDiagnostics: [diagnostic],
    };
    mocks.state.local[REVIEW_KEY] = review;

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          safeSignals: expect.arrayContaining(["filed-returns-download-manual-review-required"]),
          state: "user-action-required",
        },
      },
    });
    expect(currentAttempt()).toEqual(intentArtifactAttempt());
    expect(
      (mocks.state.local[REVIEW_KEY] as FiledReturnsTargetReview).downloadDiagnostic?.downloadId,
    ).toBeUndefined();
    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.observeBrowserDownloadById).not.toHaveBeenCalled();
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "action identity",
      diagnostic: { ...targetBoundPortalDiagnostic(41), actionId: "action-m0abc123-otherpdf" },
    },
    {
      label: "download identity",
      diagnostic: { ...targetBoundPortalDiagnostic(42), actionId: "action-m0abc123-aprilpdf" },
    },
  ])("rejects persisted attempt and diagnostic with mismatched $label", async ({ diagnostic }) => {
    mocks.state.local[REVIEW_KEY] = {
      ...reviewFor(PDF_SCOPE, observingArtifactAttempt(41)),
      downloadDiagnostic: diagnostic,
      downloadDiagnostics: [diagnostic],
    };

    await expect(readFiledReturnsTargetReview(PDF_SCOPE, deps)).resolves.toBeNull();
  });

  it("reconciles a completed exact ID after restart without a second download or portal action", async () => {
    const review = reviewFor(PDF_SCOPE, observingArtifactAttempt(41));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 1024, id: 41, state: "complete" },
    ]);

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          state: "downloaded",
          safeSignals: expect.arrayContaining([
            "filed-returns-download-reconciled-by-id",
            "filed-return-artifact-downloaded:PDF",
          ]),
        },
        flowSummary: { completedPeriods: ["April"], status: "complete" },
      },
    });
    expect(mocks.browser.downloads.search).toHaveBeenCalledWith({ id: 41 });
    expect(mocks.observeBrowserDownloadById).toHaveBeenCalledWith(
      mocks.browser.downloads,
      41,
      expect.objectContaining({ trustedDownloadIds: new Set([41]) }),
      30_000,
    );
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
    expect(mocks.state.local[REVIEW_KEY]).toBeUndefined();
    expect(mocks.state.session[COMPLETION_KEY]).toMatchObject({
      status: "complete",
      flowStep: {
        downloadDiagnostic: {
          actionId: "action-m0abc123-aprilpdf",
          artifactType: "PDF",
          byteCountClass: "non-empty",
          downloadId: 41,
          financialYear: "2026-27",
          mimeClass: "pdf",
          period: "April",
          returnType: "GSTR-3B",
          status: "downloaded",
        },
      },
    });
  });

  it("reconstructs target-bound native GSTR-3B completion without relabeling it as captured bytes", async () => {
    const review: FiledReturnsTargetReview = {
      ...reviewFor(PDF_SCOPE, observingArtifactAttempt(41)),
      downloadDiagnostic: targetBoundPortalDiagnostic(41),
    };
    mocks.state.local[REVIEW_KEY] = review;
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 1024, id: 41, state: "complete" },
    ]);

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          state: "downloaded",
          downloadDiagnostic: {
            downloadId: 41,
            downloadPathClass: "target-bound-portal-click-blob",
            endpointClass: "gstr3b-portal-rendered-download",
            mimeClass: "pdf",
          },
        },
        flowSummary: { status: "complete" },
      },
    });
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("does not normalize generic MIME for a target-bound native GSTR-3B download", async () => {
    const review: FiledReturnsTargetReview = {
      ...reviewFor(PDF_SCOPE, observingArtifactAttempt(41)),
      downloadDiagnostic: targetBoundPortalDiagnostic(41),
    };
    mocks.state.local[REVIEW_KEY] = review;
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 1024, id: 41, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(41, "generic-binary"));

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining(["filed-return-durable-status-rejected"]),
        },
      },
    });
    expect(mocks.state.session[COMPLETION_KEY]).toBeUndefined();
  });

  it("keeps a restarted direct GSTR-3B request unconfirmed when Chrome reports generic MIME", async () => {
    const review = reviewFor(PDF_SCOPE, {
      ...observingArtifactAttempt(41),
      directDownload: true,
    });
    mocks.state.local[REVIEW_KEY] = review;
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 1024, id: 41, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue({
      ...completedObservation(41, "generic-binary"),
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 41,
        mimeClass: "generic-binary",
        urlClass: "https",
      },
    });

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining(["filed-return-durable-status-rejected"]),
        },
      },
    });
    expect(mocks.observeBrowserDownloadById).toHaveBeenCalledWith(
      mocks.browser.downloads,
      41,
      expect.objectContaining({ requireExpectedMime: true }),
      30_000,
    );
    expect(mocks.state.session[COMPLETION_KEY]).toBeUndefined();
  });

  it.each(["generic-binary", "missing"] as const)(
    "reconciles a validated captured PDF when Chrome reports %s MIME",
    async (mimeClass) => {
      const review = reviewFor(PDF_SCOPE, observingArtifactAttempt(41));
      mocks.state.local[REVIEW_KEY] = review;
      mocks.browser.downloads.search.mockResolvedValue([
        { danger: "safe", exists: true, fileSize: 1024, id: 41, state: "complete" },
      ]);
      mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(41, mimeClass));

      const result = await reconcileFiledReturnsTargetDownload(review, deps);

      expect(result).toMatchObject({
        state: "handled",
        response: {
          flowStep: {
            downloadDiagnostic: { mimeClass: "pdf" },
            state: "downloaded",
          },
          flowSummary: { status: "complete" },
        },
      });
      expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
      expect(mocks.state.local[REVIEW_KEY]).toBeUndefined();
      expect(mocks.state.session[COMPLETION_KEY]).toMatchObject({ status: "complete" });
    },
  );

  it("retains the ZIP ledger when the post-OPFS cleanup checkpoint cannot be persisted", async () => {
    const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.state.local["pack:single-period-staging"] = observingBundleLedger(73);
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 2048, id: 73, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(73, "generic-binary"));
    mocks.browser.storage.local.set.mockRejectedValueOnce(
      new Error("Synthetic cleanup checkpoint write failure."),
    );

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining([
            "filed-returns-target-review-required",
            "single-period-opfs-cleared",
            "single-period-cleanup-checkpoint-failed",
            singlePeriodCleanupCheckpointFailureSignal("callback-failed"),
          ]),
          safeMessage:
            "Pack cleared temporary selected-file staging but could not verify its durable recovery checkpoint cleanup.",
        },
      },
    });
    expect(mocks.state.local["pack:single-period-staging"]).toBeDefined();
    expect(mocks.state.local[REVIEW_KEY]).toMatchObject({
      safeSignals: expect.arrayContaining([
        singlePeriodCleanupCheckpointFailureSignal("callback-failed"),
      ]),
    });
    expect(mocks.state.session[COMPLETION_KEY]).toBeUndefined();
    expect(mocks.events).toEqual(["opfs:clear", "storage:observing"]);
  });

  it.each([
    {
      arrange: () => {
        const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
        delete review.downloadAttempt;
        return { deps, flowStep: checkpointFlowStep(), review };
      },
      stage: "bundle-mismatch",
    },
    {
      arrange: () => ({
        deps,
        flowStep: {
          connectorId: "gst" as const,
          safeMessage: "Synthetic incomplete cleanup checkpoint.",
          safeSignals: [],
          scopeId: "gst-filed-returns-gstr2b-private-v0",
          state: "downloaded" as const,
        },
        review: reviewFor(ZIP_SCOPE, observingZipAttempt(73)),
      }),
      stage: "completion-evidence-missing",
    },
    {
      arrange: () => ({
        deps: { ...deps, storageKeys: { completion: COMPLETION_KEY } } as never,
        flowStep: checkpointFlowStep(),
        review: reviewFor(ZIP_SCOPE, observingZipAttempt(73)),
      }),
      stage: "completion-persist-failed",
    },
    {
      arrange: () => {
        const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
        mocks.state.local[REVIEW_KEY] = review;
        let targetReviewReads = 0;
        mocks.browser.storage.local.get.mockImplementation(async (key: string) => {
          if (key === REVIEW_KEY && ++targetReviewReads === 2) return {};
          return Object.prototype.hasOwnProperty.call(mocks.state.local, key)
            ? { [key]: mocks.state.local[key] }
            : {};
        });
        return { deps, flowStep: checkpointFlowStep(), review };
      },
      stage: "completion-mismatch",
    },
  ] as const)(
    "retains the cleanup block with the reachable $stage stage",
    async ({ arrange, stage }) => {
      const { deps: checkpointDeps, flowStep, review } = arrange();

      const cleanup = await cleanupSinglePeriodBundleStaging({
        ledgerId: "single-period:dddddddddddddddddddd",
        onAfterTransientClear: async () => {
          return Boolean(
            await persistReconciledZipCleanupCheckpoint(review, flowStep, checkpointDeps),
          );
        },
        scope: ZIP_SCOPE,
      });

      expect(cleanup).toMatchObject({
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "single-period-opfs-cleared",
          "single-period-cleanup-checkpoint-failed",
          singlePeriodCleanupCheckpointFailureSignal(stage),
        ]),
        transientStagingCleared: true,
      });
    },
  );

  it("recovers from a canonical completion write failure after checkpointed ZIP cleanup", async () => {
    const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.state.local["pack:single-period-staging"] = observingBundleLedger(73);
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 2048, id: 73, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(73, "generic-binary"));
    mocks.browser.storage.session.set.mockRejectedValueOnce(
      new Error("Synthetic canonical completion write failure."),
    );

    const first = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(first).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining([
            "filed-return-durable-status-rejected",
            "single-period-opfs-cleared",
          ]),
        },
      },
    });
    expect(mocks.state.local["pack:single-period-staging"]).toBeUndefined();
    expect(mocks.state.session[COMPLETION_KEY]).toBeUndefined();
    const retainedReview = mocks.state.local[REVIEW_KEY] as FiledReturnsTargetReview;

    const second = await reconcileFiledReturnsTargetDownload(retainedReview, deps);

    expect(second).toMatchObject({
      state: "handled",
      response: {
        flowStep: { state: "downloaded" },
        flowSummary: { status: "complete" },
      },
    });
    expect(mocks.discardSinglePeriodFiledReturnsZip).toHaveBeenCalledTimes(1);
    expect(mocks.state.local[REVIEW_KEY]).toBeUndefined();
    expect(mocks.state.session[COMPLETION_KEY]).toMatchObject({ status: "complete" });
  });

  it("keeps an intent-only checkpoint fail-closed without querying or starting a download", async () => {
    const review = reviewFor(PDF_SCOPE, intentArtifactAttempt());
    mocks.state.local[REVIEW_KEY] = review;

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          safeSignals: expect.arrayContaining(["filed-returns-download-manual-review-required"]),
          state: "user-action-required",
        },
      },
    });
    expect(mocks.browser.downloads.search).not.toHaveBeenCalled();
    expect(mocks.observeBrowserDownloadById).not.toHaveBeenCalled();
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    expect(currentAttempt()).toEqual(intentArtifactAttempt());
  });

  it.each([
    {
      expectedSignal: "filed-returns-download-id-not-found",
      label: "missing exact ID",
      search: async () => [],
    },
    {
      expectedSignal: "filed-returns-download-search-unavailable",
      label: "unavailable browser search",
      search: async () => {
        throw new Error("synthetic search failure");
      },
    },
    {
      expectedSignal: "filed-returns-download-state-unknown",
      label: "unknown browser state",
      search: async () => [{ id: 41, state: "synthetic-unknown" }],
    },
  ])(
    "keeps $label fail-closed and removes the unverified ID",
    async ({ expectedSignal, search }) => {
      const review = reviewFor(PDF_SCOPE, observingArtifactAttempt(41));
      mocks.state.local[REVIEW_KEY] = review;
      mocks.browser.downloads.search.mockImplementation(search);

      const result = await reconcileFiledReturnsTargetDownload(review, deps);

      expect(result).toMatchObject({
        state: "handled",
        response: {
          flowStep: {
            safeSignals: expect.arrayContaining(["filed-returns-download-manual-review-required"]),
            state: "user-action-required",
          },
        },
      });
      expect(result).toMatchObject({
        response: { flowSummary: { flowStep: { safeMessage: expect.any(String) } } },
      });
      const storedReview = mocks.state.local[REVIEW_KEY] as FiledReturnsTargetReview;
      expect(storedReview.safeSignals).toContain(expectedSignal);
      expect(storedReview.downloadAttempt).toEqual(intentArtifactAttempt());
      expect(mocks.observeBrowserDownloadById).not.toHaveBeenCalled();
      expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "unknown danger evidence",
      observation: {
        state: "not-observed" as const,
        safeSignals: ["browser-download-danger-unknown"],
        safeMessage: "Danger evidence is unavailable.",
      },
      storedPhase: "download-observing",
    },
    {
      label: "browser danger rejection",
      observation: {
        state: "failed" as const,
        safeSignals: ["browser-download-danger-rejected"],
        safeMessage: "The browser rejected the synthetic download.",
      },
      storedPhase: "download-intent-persisted",
    },
  ])("keeps $label fail-closed", async ({ observation, storedPhase }) => {
    const review = reviewFor(PDF_SCOPE, observingArtifactAttempt(41));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.browser.downloads.search.mockResolvedValue([{ id: 41, state: "complete" }]);
    mocks.observeBrowserDownloadById.mockResolvedValue(observation);

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: { flowSummary: { status: "blocked" } },
    });
    expect(currentAttempt()?.phase).toBe(storedPhase);
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it.each(["browser-download-interrupted", "browser-download-zero-bytes"])(
    "keeps %s evidence bound to its exact ID for manual review",
    async (safeSignal) => {
      const review = reviewFor(PDF_SCOPE, observingArtifactAttempt(41));
      mocks.state.local[REVIEW_KEY] = review;
      mocks.browser.downloads.search.mockResolvedValue([{ id: 41, state: "interrupted" }]);
      mocks.observeBrowserDownloadById.mockResolvedValue({
        state: "failed",
        safeSignals: [safeSignal],
        safeMessage: "The synthetic exact-ID download did not complete.",
      });

      await expect(reconcileFiledReturnsTargetDownload(review, deps)).resolves.toMatchObject({
        state: "handled",
        response: {
          flowSummary: {
            flowStep: {
              safeSignals: expect.arrayContaining([
                "filed-returns-target-review-required",
                "filed-returns-download-reconciliation-required",
              ]),
              state: "user-action-required",
            },
          },
        },
      });
      expect(currentAttempt()).toMatchObject({ downloadId: 41, phase: "download-observing" });
      expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    },
  );

  it("keeps legacy file-missing evidence bound to the exact ID instead of replaying", async () => {
    const review = reviewFor(PDF_SCOPE, observingArtifactAttempt(41));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.browser.downloads.search.mockResolvedValue([{ id: 41, state: "complete" }]);
    mocks.observeBrowserDownloadById.mockResolvedValue({
      state: "failed",
      safeSignals: ["browser-download-file-missing"],
      safeMessage: "The synthetic existence metadata was stale.",
    });

    await expect(reconcileFiledReturnsTargetDownload(review, deps)).resolves.toMatchObject({
      state: "handled",
      response: { flowSummary: { status: "blocked" } },
    });
    expect(currentAttempt()).toMatchObject({ downloadId: 41, phase: "download-observing" });
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("clears completed single-period ZIP staging after exact-ID reconciliation without re-export", async () => {
    const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.state.local["pack:single-period-staging"] = observingBundleLedger(73);
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 2048, id: 73, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(73, "generic-binary"));

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          state: "downloaded",
          safeSignals: expect.arrayContaining([
            "filed-returns-download-reconciled-by-id",
            "single-period-zip-downloaded",
            "single-period-opfs-cleared",
          ]),
        },
      },
    });
    expect(mocks.discardSinglePeriodFiledReturnsZip).toHaveBeenCalledWith(
      "single-period:dddddddddddddddddddd",
    );
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
    expect(mocks.state.local[REVIEW_KEY]).toBeUndefined();
    expect(mocks.state.local["pack:single-period-staging"]).toBeUndefined();
    expect(mocks.state.session[COMPLETION_KEY]).toMatchObject({
      status: "complete",
      flowStep: {
        safeSignals: expect.arrayContaining([
          "single-period-opfs-staged:PDF",
          "single-period-opfs-staged:EXCEL",
          "single-period-opfs-staged:JSON",
          "single-period-zip-downloaded",
        ]),
        downloadDiagnostics: [
          expect.objectContaining({ artifactType: "PDF", status: "downloaded" }),
          expect.objectContaining({ artifactType: "EXCEL", status: "downloaded" }),
          expect.objectContaining({ artifactType: "JSON", status: "downloaded" }),
        ],
      },
    });
    expect(mocks.events).toEqual([
      "opfs:clear",
      "storage:observing",
      "storage:staging-clear",
      "storage:completion",
      "storage:review-clear-attempt",
    ]);
  });

  it("retains ZIP staging when the exact download attempt does not match the bundle ledger", async () => {
    const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.state.local["pack:single-period-staging"] = observingBundleLedger(74);
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 2048, id: 73, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(73, "generic-binary"));

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          safeSignals: expect.arrayContaining([
            "filed-returns-target-review-required",
            "single-period-opfs-clear-failed",
            "single-period-opfs-cleanup-required",
          ]),
          state: "blocked",
        },
      },
    });
    expect(mocks.discardSinglePeriodFiledReturnsZip).not.toHaveBeenCalled();
    expect(mocks.state.local[REVIEW_KEY]).toMatchObject({
      safeSignals: expect.arrayContaining([
        "single-period-bundle-ledger-malformed",
        "single-period-opfs-retained",
      ]),
    });
    expect(mocks.state.local["pack:single-period-staging"]).toBeDefined();
    expect(mocks.state.session[COMPLETION_KEY]).toBeUndefined();
  });

  it("repairs the ZIP ledger after restart between the review and bundle download-ID writes", async () => {
    const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.state.local["pack:single-period-staging"] = intentBundleLedger();
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 2048, id: 73, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(73, "generic-binary"));

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          safeSignals: expect.arrayContaining([
            "filed-returns-download-reconciled-by-id",
            "single-period-zip-downloaded",
            "single-period-opfs-cleared",
          ]),
          state: "downloaded",
        },
        flowSummary: { status: "complete" },
      },
    });
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
    expect(mocks.discardSinglePeriodFiledReturnsZip).toHaveBeenCalledTimes(1);
    expect(mocks.state.local[REVIEW_KEY]).toBeUndefined();
    expect(mocks.state.local["pack:single-period-staging"]).toBeUndefined();
    expect(mocks.state.session[COMPLETION_KEY]).toMatchObject({ status: "complete" });
  });

  it("lets explicit cancellation clear a genuinely mismatched ZIP checkpoint", async () => {
    const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.state.local["pack:single-period-staging"] = observingBundleLedger(74);
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 2048, id: 73, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(73, "generic-binary"));

    await reconcileFiledReturnsTargetDownload(review, deps);
    const cancelled = await resolveUnconfirmedFiledReturnsDownload(ZIP_SCOPE, "cancelled", deps);

    expect(cancelled).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-returns-target-cancelled",
          "single-period-opfs-cleared",
        ]),
        state: "user-action-required",
      },
      flowSummary: { status: "cancelled" },
    });
    expect(mocks.discardSinglePeriodFiledReturnsZip).toHaveBeenCalledTimes(1);
    expect(mocks.state.local[REVIEW_KEY]).toBeUndefined();
    expect(mocks.state.local["pack:single-period-staging"]).toBeUndefined();
    expect(mocks.state.session[COMPLETION_KEY]).toMatchObject({ status: "cancelled" });
  });

  it("recovers a verified ZIP after staging cleanup succeeds but review cleanup is interrupted", async () => {
    const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
    mocks.state.local[REVIEW_KEY] = review;
    mocks.state.local["pack:single-period-staging"] = observingBundleLedger(73);
    mocks.state.failTargetReviewRemoveOnce = true;
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 2048, id: 73, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(73, "generic-binary"));

    const first = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(mocks.state.local[REVIEW_KEY]).toMatchObject({
      safeSignals: expect.arrayContaining([
        "filed-returns-target-review-clear-failed",
        "filed-returns-target-review-clear-failed:storage-remove-failed",
        "single-period-cleanup-checkpoint-failed:target-review-clear-failed",
      ]),
    });
    expect(first).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          safeSignals: expect.arrayContaining([
            "filed-returns-target-review-required",
            "single-period-cleanup-checkpoint-failed",
            "single-period-opfs-cleared",
          ]),
          state: "blocked",
        },
      },
    });
    expect(mocks.state.local["pack:single-period-staging"]).toBeUndefined();
    const retainedReview = mocks.state.local[REVIEW_KEY] as FiledReturnsTargetReview;

    const second = await reconcileFiledReturnsTargetDownload(retainedReview, deps);

    expect(second).toMatchObject({
      state: "handled",
      response: {
        flowStep: { state: "downloaded" },
        flowSummary: { status: "complete" },
      },
    });
    expect(mocks.discardSinglePeriodFiledReturnsZip).toHaveBeenCalledTimes(1);
    expect(mocks.state.local[REVIEW_KEY]).toBeUndefined();
    expect(mocks.state.session[COMPLETION_KEY]).toMatchObject({ status: "complete" });
  });

  it("retains the ZIP staging identifier when completed-download cleanup fails", async () => {
    const review = reviewFor(ZIP_SCOPE, observingZipAttempt(73));
    mocks.state.local[REVIEW_KEY] = review;
    const bundleLedger = observingBundleLedger(73);
    mocks.state.local["pack:single-period-staging"] = bundleLedger;
    mocks.browser.downloads.search.mockResolvedValue([
      { danger: "safe", exists: true, fileSize: 2048, id: 73, state: "complete" },
    ]);
    mocks.observeBrowserDownloadById.mockResolvedValue(completedObservation(73, "generic-binary"));
    mocks.discardSinglePeriodFiledReturnsZip.mockResolvedValue(["single-period-opfs-clear-failed"]);

    const result = await reconcileFiledReturnsTargetDownload(review, deps);

    expect(result).toMatchObject({
      state: "handled",
      response: {
        flowStep: {
          safeSignals: expect.arrayContaining([
            "single-period-opfs-clear-failed",
            "single-period-opfs-cleanup-required",
          ]),
          state: "blocked",
        },
      },
    });
    expect(currentAttempt()).toEqual(observingZipAttempt(73));
    expect(mocks.state.local[REVIEW_KEY]).toMatchObject({
      safeSignals: expect.arrayContaining(["single-period-opfs-clear-failed"]),
    });
    expect(mocks.state.local["pack:single-period-staging"]).toEqual(bundleLedger);
  });

  it("does not claim cleanup completed when both the ZIP attempt and staging record are missing", async () => {
    const review = {
      ...reviewFor(ZIP_SCOPE, observingZipAttempt(73)),
      safeSignals: ["single-period-zip-downloaded", "single-period-opfs-clear-failed"],
    };
    delete review.downloadAttempt;
    mocks.state.local[REVIEW_KEY] = review;

    const response = await retryCompletedSinglePeriodZipCleanup(ZIP_SCOPE, deps);

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-returns-target-review-required",
          "single-period-opfs-cleanup-required",
        ]),
        state: "blocked",
      },
      flowSummary: { status: "blocked" },
    });
    expect(mocks.discardSinglePeriodFiledReturnsZip).not.toHaveBeenCalled();
    expect(mocks.state.local[REVIEW_KEY]).toMatchObject({
      safeSignals: expect.arrayContaining([
        "single-period-opfs-clear-failed",
        "single-period-zip-recovery-checkpoint-missing",
      ]),
    });
  });
});

function reviewFor(
  scope: FiledReturnsDownloadScope,
  downloadAttempt: FiledReturnsTargetDownloadAttempt,
): FiledReturnsTargetReview {
  const artifactSuffix =
    scope.artifactType && scope.artifactType !== "PDF" ? `:${scope.artifactType}` : "";
  return {
    downloadAttempt,
    safeMessage: "The synthetic target requires exact-ID reconciliation.",
    safeSignals: ["browser-download-size-unknown"],
    schemaVersion: "1.0",
    scope,
    status: "download-unconfirmed",
    targetId: `${scope.returnType}:${scope.financialYear}:${scope.period}${artifactSuffix}`,
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
}

function targetBoundPortalDiagnostic(downloadId: number): FiledReturnsDownloadDiagnostic {
  return {
    actionId: "action-m0abc123-aprilpdf",
    artifactType: "PDF",
    byteCountClass: "unknown",
    downloadId,
    downloadPathClass: "target-bound-portal-click-blob",
    endpointClass: "gstr3b-portal-rendered-download",
    eventType: "filed-return-download-path",
    financialYear: "2026-27",
    mimeClass: "pdf",
    period: "April",
    returnType: "GSTR-3B",
    schemaVersion: "1.0",
    status: "download-unconfirmed",
  };
}

function intentArtifactAttempt(): Extract<
  FiledReturnsTargetDownloadAttempt,
  { kind: "single-artifact"; phase: "download-intent-persisted" }
> {
  return {
    actionId: "action-m0abc123-aprilpdf",
    artifactType: "PDF",
    kind: "single-artifact",
    phase: "download-intent-persisted",
    requestedAt: REQUESTED_AT,
  };
}

function observingArtifactAttempt(
  downloadId: number,
): Extract<
  FiledReturnsTargetDownloadAttempt,
  { kind: "single-artifact"; phase: "download-observing" }
> {
  return {
    ...intentArtifactAttempt(),
    downloadId,
    phase: "download-observing",
  };
}

function targetBoundCandidateAttempt(downloadId: number): FiledReturnsTargetDownloadAttempt {
  return {
    actionId: "action-m0abc123-aprilpdf",
    artifactType: "PDF",
    candidateWindowEndsAt: "2026-07-23T23:59:30.000Z",
    downloadId,
    kind: "single-artifact",
    phase: "target-bound-candidate-observing",
    requestedAt: REQUESTED_AT,
  };
}

function observingZipAttempt(downloadId: number): FiledReturnsTargetDownloadAttempt {
  return {
    artifactType: "ZIP",
    downloadId,
    kind: "single-period-zip",
    phase: "download-observing",
    requestedAt: REQUESTED_AT,
    stagingLedgerId: "single-period:dddddddddddddddddddd",
  };
}

function intentBundleLedger() {
  const created = createSinglePeriodBundleLedger(
    ZIP_SCOPE,
    "single-period:dddddddddddddddddddd",
    new Date("2026-07-23T23:58:50.000Z"),
  )!;
  const pdfRunning = markSinglePeriodBundleArtifactRunning(
    created,
    "PDF",
    new Date("2026-07-23T23:58:51.000Z"),
  )!;
  const pdfStaged = markSinglePeriodBundleArtifactStaged(
    pdfRunning,
    "PDF",
    stagedBundleStep("PDF"),
    new Date("2026-07-23T23:58:52.000Z"),
  )!;
  const excelRunning = markSinglePeriodBundleArtifactRunning(
    pdfStaged,
    "EXCEL",
    new Date("2026-07-23T23:58:53.000Z"),
  )!;
  const ready = markSinglePeriodBundleArtifactStaged(
    excelRunning,
    "EXCEL",
    stagedBundleStep("EXCEL"),
    new Date("2026-07-23T23:58:54.000Z"),
  )!;
  const jsonRunning = markSinglePeriodBundleArtifactRunning(
    ready,
    "JSON",
    new Date("2026-07-23T23:58:55.000Z"),
  )!;
  const jsonStaged = markSinglePeriodBundleArtifactStaged(
    jsonRunning,
    "JSON",
    stagedBundleStep("JSON"),
    new Date("2026-07-23T23:58:56.000Z"),
  )!;
  return markSinglePeriodBundleZipIntent(jsonStaged, new Date(REQUESTED_AT))!;
}

function observingBundleLedger(downloadId: number) {
  const intent = intentBundleLedger();
  return markSinglePeriodBundleZipDownloadId(
    intent,
    downloadId,
    new Date("2026-07-23T23:59:01.000Z"),
  )!;
}

function checkpointFlowStep(): PortalFlowStepResult {
  const stagedEvidence = singlePeriodBundleFlowStep(observingBundleLedger(73));
  if (!stagedEvidence) throw new Error("expected synthetic staged ZIP evidence");
  return {
    ...stagedEvidence,
    safeSignals: [
      ...stagedEvidence.safeSignals,
      "single-period-zip-downloaded",
      "single-period-opfs-cleared",
    ],
  };
}

function stagedBundleStep(artifactType: "PDF" | "JSON" | "EXCEL"): PortalFlowStepResult {
  return {
    connectorId: "gst",
    downloadDiagnostic: bundleDiagnostic(artifactType),
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

function bundleDiagnostic(artifactType: "PDF" | "JSON" | "EXCEL"): FiledReturnsDownloadDiagnostic {
  return {
    actionId:
      artifactType === "PDF"
        ? "action-m0abc123-pdf00001"
        : artifactType === "JSON"
          ? "action-m0abc123-json0001"
          : "action-m0abc123-excel001",
    artifactType,
    byteCountClass: "non-empty",
    downloadPathClass: "captured-portal-request-data",
    endpointClass:
      artifactType === "JSON"
        ? "gstr2b-main-world-json-captured-download"
        : "gstr2b-portal-blob-captured-download",
    eventType: "filed-return-download-path",
    financialYear: ZIP_SCOPE.financialYear,
    mimeClass: artifactType === "PDF" ? "pdf" : artifactType === "JSON" ? "json" : "spreadsheet",
    period: ZIP_SCOPE.period,
    returnType: ZIP_SCOPE.returnType,
    schemaVersion: "1.0",
    status: "downloaded",
  };
}

function currentAttempt(): FiledReturnsTargetDownloadAttempt | undefined {
  return (mocks.state.local[REVIEW_KEY] as FiledReturnsTargetReview | undefined)?.downloadAttempt;
}

function completedObservation(
  downloadId: number,
  mimeClass: "pdf" | "spreadsheet" | "generic-binary" | "missing",
) {
  return {
    state: "completed" as const,
    safeSignals: ["browser-download-completed", "browser-download-non-empty"],
    safeMessage: "The exact synthetic download completed.",
    safeEvidence: {
      byteCountClass: "non-empty" as const,
      downloadId,
      mimeClass,
      urlClass: "blob" as const,
    },
  };
}

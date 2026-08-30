import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsTargetReview } from "../../src/connectors/gst/filed-returns-contracts";
import * as ownership from "../../src/background/download-observation-ownership";
import {
  beginPendingExtensionDownloadUrl,
  extensionBlobUrlFingerprint,
  beginLiveFiledReturnsDownloadObservation,
  installFiledReturnsDurableDownloadReconciler,
  reconcileTerminalFiledReturnsDownload,
  type DurableDownloadReconcilerDownloads,
} from "../../src/background/filed-returns-durable-download-reconciler";

const review = {
  schemaVersion: "1.0",
  scope: {
    artifactType: "PDF",
    financialYear: "2026-27",
    period: "April",
    returnType: "GSTR-3B",
  },
  safeMessage: "Pack is waiting for the exact browser download.",
  safeSignals: [],
  status: "download-unconfirmed",
  targetId: "target-12345678",
  updatedAt: "2026-07-26T00:00:00.000Z",
  downloadAttempt: {
    actionId: "00000000-0000-4000-8000-000000000001",
    artifactType: "PDF",
    downloadId: 41,
    kind: "single-artifact",
    phase: "download-observing",
    requestedAt: "2026-07-26T00:00:00.000Z",
  },
} satisfies FiledReturnsTargetReview;

function downloadsWithState(state: string): {
  downloads: DurableDownloadReconcilerDownloads;
  emitCreated(item: { byExtensionId?: string; id: number; startTime?: string; url?: string }): void;
  emit(delta: { id: number; state?: { current?: string } }): void;
} {
  const listeners = new Set<(delta: { id: number; state?: { current?: string } }) => void>();
  const createdListeners = new Set<
    (item: { byExtensionId?: string; id: number; startTime?: string; url?: string }) => void
  >();
  return {
    downloads: {
      onCreated: {
        addListener: (listener) => createdListeners.add(listener),
        removeListener: (listener) => createdListeners.delete(listener),
      },
      onChanged: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
      search: vi.fn(async () => [{ id: 41, state }]),
    },
    emitCreated: (item) => createdListeners.forEach((listener) => listener(item)),
    emit: (delta) => listeners.forEach((listener) => listener(delta)),
  };
}

describe("durable filed-return download reconciler", () => {
  it("shares leaf ownership with the reconciler's existing exports and listener", async () => {
    expect(beginLiveFiledReturnsDownloadObservation).toBe(
      ownership.beginLiveFiledReturnsDownloadObservation,
    );
    expect(beginPendingExtensionDownloadUrl).toBe(ownership.beginPendingExtensionDownloadUrl);
    expect(extensionBlobUrlFingerprint).toBe(ownership.extensionBlobUrlFingerprint);

    const fixture = downloadsWithState("complete");
    const reconcileFullFiscalYearZip = vi.fn(async () => true);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      readCurrentReview: async () => null,
      reconcileFullFiscalYearZip,
      storageKeys: {},
    });
    const endObservation = ownership.beginLiveFiledReturnsDownloadObservation(41);
    try {
      fixture.emit({ id: 41, state: { current: "complete" } });
      await Promise.resolve();
      expect(reconcileFullFiscalYearZip).not.toHaveBeenCalled();

      endObservation();
      fixture.emit({ id: 41, state: { current: "complete" } });
      await vi.waitFor(() => expect(reconcileFullFiscalYearZip).toHaveBeenCalledWith(41));
    } finally {
      endObservation();
      dispose();
    }
  });

  it("reconciles a persisted exact ID only after a terminal browser state", async () => {
    const fixture = downloadsWithState("complete");
    const reconcile = vi.fn(async () => undefined);

    await expect(
      reconcileTerminalFiledReturnsDownload(fixture.downloads, {
        readCurrentReview: async () => review,
        reconcile,
        storageKeys: {},
      }),
    ).resolves.toBe(true);

    expect(reconcile).toHaveBeenCalledWith(review);
  });

  it("does not reconcile while the native Save dialog leaves the download in progress", async () => {
    const fixture = downloadsWithState("in_progress");
    const reconcile = vi.fn(async () => undefined);

    await expect(
      reconcileTerminalFiledReturnsDownload(fixture.downloads, {
        readCurrentReview: async () => review,
        reconcile,
        storageKeys: {},
      }),
    ).resolves.toBe(false);

    expect(reconcile).not.toHaveBeenCalled();
  });

  it("listens for terminal changes and ignores unrelated progress events", async () => {
    const fixture = downloadsWithState("complete");
    const reconcile = vi.fn(async () => undefined);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      readCurrentReview: async () => review,
      reconcile,
      storageKeys: {},
    });
    await Promise.resolve();
    reconcile.mockClear();

    fixture.emit({ id: 41, state: { current: "in_progress" } });
    await Promise.resolve();
    expect(reconcile).not.toHaveBeenCalled();

    fixture.emit({ id: 41, state: { current: "complete" } });
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledWith(review));
    dispose();
  });

  it("passes a terminal ID to the fiscal-year reconciler after inline ownership ends", async () => {
    const fixture = downloadsWithState("complete");
    const reconcileAllSupportedFullFiscalYearZip = vi.fn(async () => true);
    const reconcileFullFiscalYearZip = vi.fn(async () => true);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      readCurrentReview: async () => null,
      reconcileAllSupportedFullFiscalYearZip,
      reconcileFullFiscalYearZip,
      storageKeys: {},
    });
    await Promise.resolve();
    reconcileFullFiscalYearZip.mockClear();

    fixture.emit({ id: 41, state: { current: "in_progress" } });
    await Promise.resolve();
    expect(reconcileFullFiscalYearZip).not.toHaveBeenCalled();

    fixture.emit({ id: 41, state: { current: "complete" } });
    await vi.waitFor(() => expect(reconcileFullFiscalYearZip).toHaveBeenCalledWith(41));
    await vi.waitFor(() => expect(reconcileAllSupportedFullFiscalYearZip).toHaveBeenCalledWith(41));
    dispose();
  });

  it("reconciles a persisted fiscal-year ZIP checkpoint when the worker starts", async () => {
    const fixture = downloadsWithState("in_progress");
    const reconcilePersistedAllSupportedFullFiscalYearZip = vi.fn(async () => true);
    const reconcilePersistedFullFiscalYearZip = vi.fn(async () => true);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      readCurrentReview: async () => null,
      reconcilePersistedAllSupportedFullFiscalYearZip,
      reconcilePersistedFullFiscalYearZip,
      storageKeys: {},
    });

    await vi.waitFor(() => expect(reconcilePersistedFullFiscalYearZip).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(reconcilePersistedAllSupportedFullFiscalYearZip).toHaveBeenCalledOnce(),
    );
    dispose();
  });

  it("persists an extension-owned created download that arrives before the caller has its ID", async () => {
    const fixture = downloadsWithState("complete");
    let currentReview: FiledReturnsTargetReview = {
      ...review,
      downloadAttempt: {
        actionId: review.downloadAttempt.actionId,
        artifactType: "PDF",
        kind: "single-artifact",
        phase: "download-intent-persisted",
        requestedAt: review.downloadAttempt.requestedAt,
      },
    };
    const persistDownloadId = vi.fn(async () => {
      currentReview = review;
      return true;
    });
    const reconcile = vi.fn(async () => undefined);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      extensionId: "pack-id",
      persistDownloadId,
      reconcile,
      readCurrentReview: async () => currentReview,
      storageKeys: {},
    });
    await Promise.resolve();
    persistDownloadId.mockClear();
    const endPendingDownloadUrl = beginPendingExtensionDownloadUrl(
      "blob:chrome-extension://pack-id/zip",
    );

    fixture.emitCreated({
      byExtensionId: "pack-id",
      id: 41,
      startTime: "2026-07-26T00:00:01.000Z",
      url: "blob:chrome-extension://pack-id/zip",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(persistDownloadId).toHaveBeenCalledWith(expect.anything(), 41);
    reconcile.mockClear();
    fixture.emit({ id: 41, state: { current: "complete" } });
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledWith(review));
    endPendingDownloadUrl();
    dispose();
  });

  it("reconciles a terminal event that arrived while its exact ID was persisting", async () => {
    const fixture = downloadsWithState("complete");
    let currentReview: FiledReturnsTargetReview = {
      ...review,
      downloadAttempt: {
        actionId: review.downloadAttempt.actionId,
        artifactType: "PDF",
        kind: "single-artifact",
        phase: "download-intent-persisted",
        requestedAt: review.downloadAttempt.requestedAt,
      },
    };
    let resolvePersist!: (value: boolean) => void;
    const persistDownloadId = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePersist = resolve;
        }),
    );
    const reconcile = vi.fn(async () => undefined);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      extensionId: "pack-id",
      persistDownloadId,
      readCurrentReview: async () => currentReview,
      reconcile,
      storageKeys: {},
    });
    await Promise.resolve();
    reconcile.mockClear();
    const endPendingDownloadUrl = beginPendingExtensionDownloadUrl(
      "blob:chrome-extension://pack-id/zip",
    );

    fixture.emitCreated({
      byExtensionId: "pack-id",
      id: 41,
      startTime: "2026-07-26T00:00:01.000Z",
      url: "blob:chrome-extension://pack-id/zip",
    });
    fixture.emit({ id: 41, state: { current: "complete" } });
    await vi.waitFor(() => expect(persistDownloadId).toHaveBeenCalledOnce());
    currentReview = review;
    resolvePersist(true);

    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledWith(review));
    endPendingDownloadUrl();
    dispose();
  });

  it("keeps a full-year terminal ID that arrived while an extension ZIP was persisting", async () => {
    const fixture = downloadsWithState("complete");
    let currentReview: FiledReturnsTargetReview = {
      ...review,
      downloadAttempt: {
        actionId: review.downloadAttempt.actionId,
        artifactType: "PDF",
        kind: "single-artifact",
        phase: "download-intent-persisted",
        requestedAt: review.downloadAttempt.requestedAt,
      },
    };
    let resolvePersist!: (value: boolean) => void;
    const persistDownloadId = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePersist = resolve;
        }),
    );
    const reconcileFullFiscalYearZip = vi.fn(async () => true);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      extensionId: "pack-id",
      persistDownloadId,
      readCurrentReview: async () => currentReview,
      reconcileFullFiscalYearZip,
      storageKeys: {},
    });
    await Promise.resolve();
    reconcileFullFiscalYearZip.mockClear();
    const endPendingDownloadUrl = beginPendingExtensionDownloadUrl(
      "blob:chrome-extension://pack-id/zip",
    );

    fixture.emitCreated({
      byExtensionId: "pack-id",
      id: 41,
      startTime: "2026-07-26T00:00:01.000Z",
      url: "blob:chrome-extension://pack-id/zip",
    });
    fixture.emit({ id: 41, state: { current: "complete" } });
    await vi.waitFor(() => expect(persistDownloadId).toHaveBeenCalledOnce());
    currentReview = review;
    resolvePersist(true);

    await vi.waitFor(() => expect(reconcileFullFiscalYearZip).toHaveBeenCalledWith(41));
    endPendingDownloadUrl();
    dispose();
  });

  it("does not bind another Pack download that only shares the ZIP intent window", async () => {
    const fixture = downloadsWithState("complete");
    const currentReview: FiledReturnsTargetReview = {
      ...review,
      downloadAttempt: {
        actionId: review.downloadAttempt.actionId,
        artifactType: "PDF",
        kind: "single-artifact",
        phase: "download-intent-persisted",
        requestedAt: review.downloadAttempt.requestedAt,
      },
    };
    const persistDownloadId = vi.fn(async () => true);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      extensionId: "pack-id",
      persistDownloadId,
      readCurrentReview: async () => currentReview,
      storageKeys: {},
    });
    const endPendingDownloadUrl = beginPendingExtensionDownloadUrl(
      "blob:chrome-extension://pack-id/selected-file-zip",
    );
    await Promise.resolve();
    persistDownloadId.mockClear();

    fixture.emitCreated({
      byExtensionId: "pack-id",
      id: 77,
      startTime: "2026-07-26T00:00:01.000Z",
      url: "blob:chrome-extension://pack-id/download-prompt-probe",
    });
    await Promise.resolve();

    expect(persistDownloadId).not.toHaveBeenCalled();
    endPendingDownloadUrl();
    dispose();
  });

  it("rebinds a selected ZIP after a worker restart from its persisted URL fingerprint", async () => {
    const fixture = downloadsWithState("complete");
    const url = "blob:chrome-extension://pack-id/restart-safe-zip";
    const extensionBlobUrlFingerprintValue = await extensionBlobUrlFingerprint(url);
    expect(extensionBlobUrlFingerprintValue).toMatch(/^[a-f0-9]{64}$/);
    const currentReview: FiledReturnsTargetReview = {
      ...review,
      downloadAttempt: {
        artifactType: "ZIP",
        extensionBlobUrlFingerprint: extensionBlobUrlFingerprintValue!,
        kind: "single-period-zip",
        phase: "download-intent-persisted",
        requestedAt: review.downloadAttempt.requestedAt,
        stagingLedgerId: "single-period:restart-safe",
      },
    };
    const persistDownloadId = vi.fn(async () => true);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      extensionId: "pack-id",
      persistDownloadId,
      readCurrentReview: async () => currentReview,
      storageKeys: {},
    });

    fixture.emitCreated({
      byExtensionId: "pack-id",
      id: 52,
      startTime: "2026-07-26T00:00:01.000Z",
      url,
    });
    await vi.waitFor(() => expect(persistDownloadId).toHaveBeenCalledWith(currentReview, 52));
    dispose();
  });

  it("does not race an inline exact-ID observer that is still finalizing", async () => {
    const fixture = downloadsWithState("complete");
    const reconcile = vi.fn(async () => undefined);
    const stopInlineObservation = beginLiveFiledReturnsDownloadObservation(41);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      readCurrentReview: async () => review,
      reconcile,
      storageKeys: {},
    });
    await Promise.resolve();
    reconcile.mockClear();

    fixture.emit({ id: 41, state: { current: "complete" } });
    await Promise.resolve();
    expect(reconcile).not.toHaveBeenCalled();
    stopInlineObservation();
    dispose();
  });

  it("reconciles after inline ownership ends even when created-ID persistence settled late", async () => {
    const fixture = downloadsWithState("complete");
    let currentReview: FiledReturnsTargetReview = {
      ...review,
      downloadAttempt: {
        actionId: review.downloadAttempt.actionId,
        artifactType: "PDF",
        kind: "single-artifact",
        phase: "download-intent-persisted",
        requestedAt: review.downloadAttempt.requestedAt,
      },
    };
    let resolvePersist!: (value: boolean) => void;
    const persistDownloadId = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePersist = resolve;
        }),
    );
    const reconcile = vi.fn(async () => undefined);
    const dispose = installFiledReturnsDurableDownloadReconciler(fixture.downloads, {
      extensionId: "pack-id",
      persistDownloadId,
      readCurrentReview: async () => currentReview,
      reconcile,
      storageKeys: {},
    });
    await Promise.resolve();
    const endPendingDownloadUrl = beginPendingExtensionDownloadUrl(
      "blob:chrome-extension://pack-id/zip",
    );

    fixture.emitCreated({
      byExtensionId: "pack-id",
      id: 41,
      startTime: "2026-07-26T00:00:01.000Z",
      url: "blob:chrome-extension://pack-id/zip",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(persistDownloadId).toHaveBeenCalledTimes(1);
    const endInlineObservation = beginLiveFiledReturnsDownloadObservation(41);
    currentReview = review;
    resolvePersist(true);
    await Promise.resolve();
    await Promise.resolve();
    endInlineObservation();
    reconcile.mockClear();

    fixture.emit({ id: 41, state: { current: "complete" } });
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledWith(review));
    endPendingDownloadUrl();
    dispose();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeDownloadTriggerWithDownloadObservation,
  mergeFlowStepWithDownloadObservation,
  observeNextBrowserDownload,
  type DownloadCreatedItem,
  type DownloadDelta,
} from "../../src/background/download-observer";
import type { PortalDownloadTriggerResult, PortalFlowStepResult } from "../../src/core/contracts";

describe("download observer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a completed non-empty browser download", async () => {
    const downloads = createDownloadsApi([{ id: 7, state: "complete", fileSize: 1234 }]);
    const observation = observeNextBrowserDownload(downloads, 1_000);

    downloads.created.emit({ id: 7, state: "in_progress" });
    downloads.changed.emit({ id: 7, state: { current: "complete" } });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining([
        "browser-download-created",
        "browser-download-completed",
        "browser-download-non-empty",
      ]),
    });
  });

  it("reports a user-action state when no browser download is observed", async () => {
    const downloads = createDownloadsApi([]);
    const observation = observeNextBrowserDownload(downloads, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: ["browser-download-not-observed"],
      userAction: {
        type: "ALLOW_MULTIPLE_DOWNLOADS",
        canResume: true,
      },
    });
  });

  it("reports an interrupted browser download without exposing filenames", async () => {
    const downloads = createDownloadsApi([]);
    const observation = observeNextBrowserDownload(downloads, 1_000);

    downloads.created.emit({ id: 8, state: "in_progress" });
    downloads.changed.emit({
      id: 8,
      state: { current: "interrupted" },
      error: { current: "FILE_FAILED" },
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "failed",
      safeSignals: expect.arrayContaining([
        "browser-download-created",
        "browser-download-interrupted",
        "browser-download-error-file-failed",
      ]),
    });
  });

  it("treats a zero-byte completed download as failed", async () => {
    const downloads = createDownloadsApi([{ id: 9, state: "complete", fileSize: 0 }]);
    const observation = observeNextBrowserDownload(downloads, 1_000);

    downloads.created.emit({ id: 9, state: "complete" });

    await expect(observation.promise).resolves.toMatchObject({
      state: "failed",
      safeSignals: expect.arrayContaining([
        "browser-download-completed",
        "browser-download-zero-bytes",
      ]),
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
      },
    });
  });

  it("merges completed evidence into guided flow steps", () => {
    const step: PortalFlowStepResult = {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "clicked",
      safeSignals: ["filed-gstr3b-download-clicked"],
      safeMessage: "Clicked.",
    };

    expect(
      mergeFlowStepWithDownloadObservation(step, {
        state: "completed",
        safeSignals: ["browser-download-completed"],
        safeMessage: "Completed.",
      }),
    ).toMatchObject({
      state: "downloaded",
      safeSignals: ["filed-gstr3b-download-clicked", "browser-download-completed"],
      safeMessage: "Completed.",
    });
  });

  it("merges missing download evidence into direct trigger results", () => {
    const trigger: PortalDownloadTriggerResult = {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "clicked",
      safeSignals: ["filed-gstr3b-download-clicked"],
      safeMessage: "Clicked.",
    };

    expect(
      mergeDownloadTriggerWithDownloadObservation(trigger, {
        state: "not-observed",
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "No browser event.",
        userAction: {
          type: "ALLOW_MULTIPLE_DOWNLOADS",
          message: "Allow downloads.",
          canResume: true,
        },
      }),
    ).toMatchObject({
      state: "download-unconfirmed",
      safeSignals: ["filed-gstr3b-download-clicked", "browser-download-not-observed"],
      safeMessage: "No browser event.",
      userAction: {
        type: "ALLOW_MULTIPLE_DOWNLOADS",
      },
    });
  });
});

function createDownloadsApi(items: Array<{ id: number; state?: string; fileSize?: number }>) {
  const created = createEvent<DownloadCreatedItem>();
  const changed = createEvent<DownloadDelta>();

  return {
    created,
    changed,
    onCreated: created.api,
    onChanged: changed.api,
    search: vi.fn(async ({ id }: { id: number }) => items.filter((item) => item.id === id)),
  };
}

function createEvent<T>() {
  const listeners = new Set<(input: T) => void>();
  return {
    api: {
      addListener(listener: (input: T) => void) {
        listeners.add(listener);
      },
      removeListener(listener: (input: T) => void) {
        listeners.delete(listener);
      },
    },
    emit(input: T) {
      for (const listener of listeners) listener(input);
    },
  };
}

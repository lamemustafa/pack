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

  it("treats an unknown completed download size as unconfirmed", async () => {
    const downloads = createDownloadsApi([{ id: 71, state: "complete" }]);
    const observation = observeNextBrowserDownload(downloads, 1_000);

    downloads.created.emit({ id: 71, state: "complete" });

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-size-unknown"]),
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
      },
    });
  });

  it("ignores unrelated downloads while waiting for the GST PDF", async () => {
    const armedAt = new Date("2026-06-24T10:00:00.000Z");
    const downloads = createDownloadsApi([
      {
        id: 12,
        state: "complete",
        fileSize: 999,
        mime: "image/png",
        url: "https://example.com/logo.png",
      },
      {
        id: 13,
        state: "complete",
        fileSize: 1234,
        mime: "application/pdf",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, {
      armedAt,
      expectedFileExtensions: [".pdf"],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
    });

    downloads.created.emit({
      id: 12,
      mime: "image/png",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://example.com/logo.png",
    });
    downloads.created.emit({
      id: 13,
      mime: "application/pdf",
      startTime: "2026-06-24T10:00:02.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:13"]),
    });
  });

  it("rejects a GST-origin download that is not plausibly a PDF", async () => {
    const downloads = createDownloadsApi([
      {
        id: 14,
        state: "complete",
        fileSize: 1234,
        mime: "text/csv",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/export",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, {
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      expectedFileExtensions: [".pdf"],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
    });

    downloads.created.emit({
      id: 14,
      mime: "text/csv",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/export",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
      },
    });
  });

  it("rejects a GST-origin download with no PDF file evidence", async () => {
    const downloads = createDownloadsApi([
      {
        id: 15,
        state: "complete",
        fileSize: 1234,
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, {
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      expectedFileExtensions: [".pdf"],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
    });

    downloads.created.emit({
      id: 15,
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
      },
    });
  });

  it("tracks GST-origin downloads before final PDF evidence is available", async () => {
    const downloads = createDownloadsApi([
      {
        filename: "GSTR3B.pdf",
        id: 16,
        mime: "application/pdf",
        state: "complete",
        fileSize: 1234,
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, {
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      expectedFileExtensions: [".pdf"],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
    });

    downloads.created.emit({
      id: 16,
      startTime: "2026-06-24T10:00:01.000Z",
      state: "in_progress",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });
    downloads.changed.emit({ id: 16, state: { current: "complete" } });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:16"]),
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

function createDownloadsApi(items: DownloadCreatedItem[]) {
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

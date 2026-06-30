import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeDownloadTriggerWithDownloadObservation,
  mergeFlowStepWithDownloadObservation,
  observeBrowserDownloadById,
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

  it("observes only the browser download id returned by the direct download API", async () => {
    const downloads = createDownloadsApi([
      {
        filename: "unrelated.pdf",
        id: 80,
        mime: "application/pdf",
        state: "complete",
        fileSize: 1234,
        startTime: "2026-06-24T10:00:01.000Z",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/getgenpdf",
      },
      {
        filename: "May-GSTR-3B.pdf",
        id: 81,
        mime: "application/pdf",
        state: "complete",
        fileSize: 2048,
        startTime: "2026-06-24T10:00:02.000Z",
        url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
      },
    ]);

    await expect(
      observeBrowserDownloadById(downloads, 81, {
        armedAt: new Date("2026-06-24T10:00:00.000Z"),
        expectedFileExtensions: [".pdf"],
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: ["https://return.gst.gov.in"],
      }),
    ).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:81"]),
    });
  });

  it("rejects completed GST PDFs that do not match the requested return period marker", async () => {
    const downloads = createDownloadsApi([
      {
        filename: "April-GSTR-3B.pdf",
        id: 83,
        mime: "application/pdf",
        state: "complete",
        fileSize: 2048,
        startTime: "2026-06-24T10:00:02.000Z",
        url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=042026",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, {
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      expectedFileExtensions: [".pdf"],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
      expectedUrlSubstrings: ["rtn_prd=052026"],
    });

    downloads.created.emit({
      filename: "April-GSTR-3B.pdf",
      id: 83,
      mime: "application/pdf",
      startTime: "2026-06-24T10:00:02.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=042026",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it("rejects same-period GST PDFs outside the reviewed filed return endpoint", async () => {
    const downloads = createDownloadsApi([
      {
        filename: "May-GSTR-3B.pdf",
        id: 85,
        mime: "application/pdf",
        state: "complete",
        fileSize: 2048,
        startTime: "2026-06-24T10:00:02.000Z",
        url: "https://return.gst.gov.in/returns/auth/api/gstr3b/preview?rtn_prd=052026",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, {
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      expectedFileExtensions: [".pdf"],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
      expectedUrlSubstrings: ["/returns/auth/api/gstr3b/getgenpdf", "rtn_prd=052026"],
    });

    downloads.created.emit({
      filename: "May-GSTR-3B.pdf",
      id: 85,
      mime: "application/pdf",
      startTime: "2026-06-24T10:00:02.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/api/gstr3b/preview?rtn_prd=052026",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it("accepts a trusted suggested download id even if final URL evidence is missing", async () => {
    const suggestedFilename = "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf";
    const downloads = createDownloadsApi([
      {
        filename: suggestedFilename,
        id: 84,
        mime: "application/download",
        state: "complete",
        fileSize: 2048,
        startTime: "2026-06-24T10:00:02.000Z",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, {
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      expectedFileExtensions: [".pdf"],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
      expectedUrlSubstrings: ["rtn_prd=052026"],
      ignoredFilenames: [suggestedFilename],
      trustedDownloadIds: new Set([84]),
    });

    downloads.created.emit({
      filename: suggestedFilename,
      id: 84,
      mime: "application/download",
      startTime: "2026-06-24T10:00:02.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:84"]),
    });
  });

  it("rechecks the direct download id after subscribing to avoid missing a fast completion", async () => {
    const created = createEvent<DownloadCreatedItem>();
    const changed = createEvent<DownloadDelta>();
    const search = vi
      .fn()
      .mockResolvedValueOnce([{ id: 82, state: "in_progress" }])
      .mockResolvedValueOnce([
        {
          filename: "May-GSTR-3B.pdf",
          id: 82,
          mime: "application/pdf",
          state: "complete",
          fileSize: 2048,
          startTime: "2026-06-24T10:00:02.000Z",
          url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
        },
      ])
      .mockResolvedValueOnce([
        {
          filename: "May-GSTR-3B.pdf",
          id: 82,
          mime: "application/pdf",
          state: "complete",
          fileSize: 2048,
          startTime: "2026-06-24T10:00:02.000Z",
          url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
        },
      ]);

    await expect(
      observeBrowserDownloadById(
        {
          onCreated: created.api,
          onChanged: changed.api,
          search,
        },
        82,
        {
          armedAt: new Date("2026-06-24T10:00:00.000Z"),
          expectedFileExtensions: [".pdf"],
          expectedMimeTypes: ["application/pdf"],
          expectedOrigins: ["https://return.gst.gov.in"],
        },
      ),
    ).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:82"]),
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

  it("rejects contradictory MIME evidence even when the filename looks like a PDF", async () => {
    const downloads = createDownloadsApi([
      {
        id: 147,
        state: "complete",
        fileSize: 1234,
        filename: "GSTR3B.pdf",
        mime: "text/csv",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download.pdf",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, {
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      expectedFileExtensions: [".pdf"],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
    });

    downloads.created.emit({
      id: 147,
      filename: "GSTR3B.pdf",
      mime: "text/csv",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download.pdf",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it("accepts generic attachment MIME evidence when the filename proves a PDF", async () => {
    const downloads = createDownloadsApi([
      {
        filename: "GSTR3B.pdf",
        id: 148,
        mime: "application/download",
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
      filename: "GSTR3B.pdf",
      id: 148,
      mime: "application/download",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:148"]),
    });
  });

  it("does not ignore portal-supplied basename evidence for a suggested Pack path", async () => {
    const suggestedFilename = "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf";
    const downloads = createDownloadsApi([
      {
        filename: "may.pdf",
        id: 153,
        mime: "application/download",
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
      ignoredFilenames: [suggestedFilename],
    });

    downloads.created.emit({
      filename: "may.pdf",
      id: 153,
      mime: "application/download",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:153"]),
    });
  });

  it("does not let a caller-supplied direct-download filename prove PDF evidence", async () => {
    const downloads = createDownloadsApi([
      {
        filename: "ComplyEaze-Pack/GSTR-3B/2026-27/May-GSTR-3B.pdf",
        id: 149,
        mime: "application/download",
        state: "complete",
        fileSize: 1234,
        url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, {
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      expectedFileExtensions: [],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
    });

    downloads.created.emit({
      filename: "ComplyEaze-Pack/GSTR-3B/2026-27/May-GSTR-3B.pdf",
      id: 149,
      mime: "application/download",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it("does not let a Pack-suggested filename prove PDF evidence", async () => {
    const suggestedFilename = "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf";
    const downloads = createDownloadsApi([
      {
        filename: suggestedFilename,
        id: 150,
        mime: "application/download",
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
      ignoredFilenames: [suggestedFilename],
    });

    downloads.created.emit({
      filename: suggestedFilename,
      id: 150,
      mime: "application/download",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it("does not let absolute or uniquified Pack-suggested paths prove PDF evidence", async () => {
    const suggestedFilename = "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf";
    const returnedFilename = "/downloads/complyeaze-pack/gst/2026-27/gstr-3b/may (1).pdf";
    const downloads = createDownloadsApi([
      {
        filename: returnedFilename,
        id: 151,
        mime: "application/download",
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
      ignoredFilenames: [suggestedFilename],
    });

    downloads.created.emit({
      filename: returnedFilename,
      id: 151,
      mime: "application/download",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it("accepts original filename evidence captured before suggesting the Pack path", async () => {
    const suggestedFilename = "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf";
    const downloads = createDownloadsApi([
      {
        filename: suggestedFilename,
        id: 152,
        mime: "application/download",
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
      ignoredFilenames: [suggestedFilename],
      trustedDownloadIds: new Set([152]),
    });

    downloads.created.emit({
      filename: suggestedFilename,
      id: 152,
      mime: "application/download",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:152"]),
    });
  });

  it("keeps waiting when a same-origin non-PDF completes before the GST PDF", async () => {
    const downloads = createDownloadsApi([
      {
        id: 141,
        state: "complete",
        fileSize: 1234,
        mime: "text/csv",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/export",
      },
      {
        id: 142,
        state: "complete",
        fileSize: 4321,
        mime: "application/pdf",
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
      id: 141,
      mime: "text/csv",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/export",
    });
    downloads.created.emit({
      id: 142,
      mime: "application/pdf",
      startTime: "2026-06-24T10:00:02.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:142"]),
    });
  });

  it("does not accept same-origin downloads missing start time evidence", async () => {
    const downloads = createDownloadsApi([
      {
        id: 143,
        state: "complete",
        fileSize: 1234,
        mime: "application/pdf",
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
      id: 143,
      mime: "application/pdf",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: ["browser-download-not-observed"],
    });
  });

  it("uses later positive byte evidence when fileSize is zero but totalBytes is known", async () => {
    const downloads = createDownloadsApi([
      {
        id: 144,
        state: "complete",
        fileSize: 0,
        totalBytes: 2048,
        mime: "application/pdf",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
    ]);
    const observation = observeNextBrowserDownload(downloads, 1_000);

    downloads.created.emit({ id: 144, state: "complete" });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-non-empty"]),
    });
  });

  it("keeps waiting when download search rejects for one candidate", async () => {
    const downloads = createDownloadsApi([
      {
        id: 146,
        state: "complete",
        fileSize: 1234,
        mime: "application/pdf",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
    ]);
    downloads.search.mockImplementationOnce(async () => {
      throw new Error("downloads search unavailable");
    });
    const observation = observeNextBrowserDownload(downloads, {
      armedAt: new Date("2026-06-24T10:00:00.000Z"),
      expectedFileExtensions: [".pdf"],
      expectedMimeTypes: ["application/pdf"],
      expectedOrigins: ["https://return.gst.gov.in"],
    });

    downloads.created.emit({
      id: 145,
      mime: "application/pdf",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });
    downloads.created.emit({
      id: 146,
      mime: "application/pdf",
      startTime: "2026-06-24T10:00:02.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:146"]),
    });
  });

  it("resolves as not observed when stopped before a download is confirmed", async () => {
    const downloads = createDownloadsApi([]);
    const observation = observeNextBrowserDownload(downloads, 1_000);

    observation.stop();

    await expect(observation.promise).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: ["browser-download-observation-stopped"],
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
    await vi.advanceTimersByTimeAsync(30_000);

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

  it("keeps waiting when a same-origin non-PDF is interrupted before the GST PDF", async () => {
    const downloads = createDownloadsApi([
      {
        id: 18,
        state: "interrupted",
        fileSize: 512,
        mime: "text/csv",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/export",
      },
      {
        id: 19,
        state: "complete",
        fileSize: 4096,
        mime: "application/pdf",
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
      id: 18,
      mime: "text/csv",
      startTime: "2026-06-24T10:00:01.000Z",
      state: "in_progress",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/export",
    });
    downloads.changed.emit({
      id: 18,
      state: { current: "interrupted" },
      error: { current: "FILE_FAILED" },
    });
    downloads.created.emit({
      id: 19,
      mime: "application/pdf",
      startTime: "2026-06-24T10:00:02.000Z",
      state: "complete",
      url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
    });

    await expect(observation.promise).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:19"]),
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

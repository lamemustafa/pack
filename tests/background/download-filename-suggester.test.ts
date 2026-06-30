import { describe, expect, it, vi } from "vitest";
import { suggestNextBrowserDownloadFilename } from "../../src/background/download-filename-suggester";
import type { DownloadCreatedItem } from "../../src/background/download-observer";

describe("download filename suggester", () => {
  it("suggests the target path for the next matching GST PDF download", () => {
    const downloads = createDownloadsApi();
    const trustedDownloadIds = new Set<number>();
    const suggestion = suggestNextBrowserDownloadFilename(
      downloads,
      {
        armedAt: new Date("2026-06-24T10:00:00.000Z"),
        expectedFileExtensions: [".pdf"],
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: ["https://return.gst.gov.in"],
        trustedDownloadIds,
      },
      "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
    );
    const suggest = vi.fn();

    downloads.determiningFilename.emit(
      {
        id: 91,
        mime: "application/pdf",
        startTime: "2026-06-24T10:00:01.000Z",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
      suggest,
    );

    expect(suggest).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
    });
    expect(trustedDownloadIds.has(91)).toBe(true);
    expect(downloads.determiningFilename.listenerCount()).toBe(0);
    suggestion.stop();
  });

  it("does not suggest Pack paths for unrelated or known HTML downloads", () => {
    const downloads = createDownloadsApi();
    suggestNextBrowserDownloadFilename(
      downloads,
      {
        armedAt: new Date("2026-06-24T10:00:00.000Z"),
        expectedFileExtensions: [".pdf"],
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: ["https://return.gst.gov.in"],
      },
      "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
    );
    const unrelatedSuggest = vi.fn();
    const htmlSuggest = vi.fn();

    downloads.determiningFilename.emit(
      {
        id: 92,
        mime: "application/pdf",
        startTime: "2026-06-24T10:00:01.000Z",
        url: "https://example.com/file.pdf",
      },
      unrelatedSuggest,
    );
    downloads.determiningFilename.emit(
      {
        id: 93,
        mime: "text/html",
        startTime: "2026-06-24T10:00:02.000Z",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
      htmlSuggest,
    );

    expect(unrelatedSuggest).toHaveBeenCalledWith();
    expect(htmlSuggest).toHaveBeenCalledWith();
    expect(downloads.determiningFilename.listenerCount()).toBe(1);
  });

  it("does not consume the hook for generic GST downloads without PDF evidence", () => {
    const downloads = createDownloadsApi();
    const trustedDownloadIds = new Set<number>();
    suggestNextBrowserDownloadFilename(
      downloads,
      {
        armedAt: new Date("2026-06-24T10:00:00.000Z"),
        expectedFileExtensions: [".pdf"],
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: ["https://return.gst.gov.in"],
        trustedDownloadIds,
      },
      "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
    );
    const genericSuggest = vi.fn();
    const pdfSuggest = vi.fn();

    downloads.determiningFilename.emit(
      {
        id: 94,
        mime: "application/download",
        startTime: "2026-06-24T10:00:01.000Z",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
      genericSuggest,
    );
    downloads.determiningFilename.emit(
      {
        filename: "GSTR3B.pdf",
        id: 95,
        mime: "application/download",
        startTime: "2026-06-24T10:00:02.000Z",
        url: "https://return.gst.gov.in/returns/auth/gstr3b/download",
      },
      pdfSuggest,
    );

    expect(genericSuggest).toHaveBeenCalledWith();
    expect(pdfSuggest).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
    });
    expect(trustedDownloadIds.has(94)).toBe(false);
    expect(trustedDownloadIds.has(95)).toBe(true);
    expect(downloads.determiningFilename.listenerCount()).toBe(0);
  });

  it("binds suggestions to the requested return-period URL marker", () => {
    const downloads = createDownloadsApi();
    const trustedDownloadIds = new Set<number>();
    suggestNextBrowserDownloadFilename(
      downloads,
      {
        armedAt: new Date("2026-06-24T10:00:00.000Z"),
        expectedFileExtensions: [".pdf"],
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: ["https://return.gst.gov.in"],
        expectedUrlSubstrings: ["rtn_prd=052026"],
        trustedDownloadIds,
      },
      "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
    );
    const otherPeriodSuggest = vi.fn();
    const targetPeriodSuggest = vi.fn();

    downloads.determiningFilename.emit(
      {
        filename: "GSTR3B.pdf",
        id: 96,
        mime: "application/download",
        startTime: "2026-06-24T10:00:01.000Z",
        url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=042026",
      },
      otherPeriodSuggest,
    );
    downloads.determiningFilename.emit(
      {
        filename: "GSTR3B.pdf",
        id: 97,
        mime: "application/download",
        startTime: "2026-06-24T10:00:02.000Z",
        url: "https://return.gst.gov.in/returns/auth/api/gstr3b/getgenpdf?rtn_prd=052026",
      },
      targetPeriodSuggest,
    );

    expect(otherPeriodSuggest).toHaveBeenCalledWith();
    expect(targetPeriodSuggest).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "complyeaze-pack/gst/2026-27/gstr-3b/may.pdf",
    });
    expect(trustedDownloadIds.has(96)).toBe(false);
    expect(trustedDownloadIds.has(97)).toBe(true);
    expect(downloads.determiningFilename.listenerCount()).toBe(0);
  });
});

function createDownloadsApi() {
  const determiningFilename =
    createDeterminingFilenameEvent<(item: DownloadCreatedItem, suggest: SuggestCallback) => void>();

  return {
    determiningFilename,
    onDeterminingFilename: determiningFilename.api,
  };
}

type SuggestCallback = (suggestion?: { filename: string; conflictAction: "uniquify" }) => void;

function createDeterminingFilenameEvent<T extends (...args: never[]) => void>() {
  const listeners = new Set<T>();
  return {
    api: {
      addListener(listener: T) {
        listeners.add(listener);
      },
      removeListener(listener: T) {
        listeners.delete(listener);
      },
    },
    emit(...args: Parameters<T>) {
      for (const listener of listeners) listener(...args);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

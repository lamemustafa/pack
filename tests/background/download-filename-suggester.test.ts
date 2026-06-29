import { describe, expect, it, vi } from "vitest";
import { suggestNextBrowserDownloadFilename } from "../../src/background/download-filename-suggester";
import type { DownloadCreatedItem } from "../../src/background/download-observer";

describe("download filename suggester", () => {
  it("suggests the target path for the next matching GST PDF download", () => {
    const downloads = createDownloadsApi();
    const suggestion = suggestNextBrowserDownloadFilename(
      downloads,
      {
        armedAt: new Date("2026-06-24T10:00:00.000Z"),
        expectedFileExtensions: [".pdf"],
        expectedMimeTypes: ["application/pdf"],
        expectedOrigins: ["https://return.gst.gov.in"],
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

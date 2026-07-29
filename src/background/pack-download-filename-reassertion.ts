import { browser } from "wxt/browser";

type FilenameSuggestion = {
  conflictAction: "uniquify";
  filename: string;
};

export type FilenameDeterminationListener = (
  item: { id: number; url?: string },
  suggest: (suggestion: FilenameSuggestion) => void,
) => void;

export interface FilenameDeterminationApi {
  onDeterminingFilename?: {
    addListener(listener: FilenameDeterminationListener): void;
  };
}

export interface PackDownloadFilenameReassertion {
  reserve(url: string, filename: string): PackDownloadFilenameReservation;
}

export interface PackDownloadFilenameReservation {
  bind(downloadId: number): void;
  release(): void;
}

export function createPackDownloadFilenameReassertion(
  downloads: FilenameDeterminationApi | undefined,
): PackDownloadFilenameReassertion {
  type RequestedFilename = { filename: string };
  // This is immediate event correlation, not run truth: callers reserve just before download()
  // and release at its terminal observation. Blob URLs must never enter durable extension storage.
  const requestedFilenamesByDownloadId = new Map<number, RequestedFilename>();
  const requestedFilenamesByUrl = new Map<string, RequestedFilename>();

  downloads?.onDeterminingFilename?.addListener((item, suggest) => {
    const requested =
      requestedFilenamesByDownloadId.get(item.id) ??
      (item.url ? requestedFilenamesByUrl.get(item.url) : undefined);
    if (!requested) return;
    suggest({ conflictAction: "uniquify", filename: requested.filename });
  });

  return {
    reserve(url, filename) {
      if (!isOwnedBlobUrl(url) || !isRequestedFilename(filename)) return noOpReservation();
      const requested = { filename };
      let boundDownloadId: number | null = null;
      let released = false;
      requestedFilenamesByUrl.set(url, requested);
      return {
        bind(downloadId) {
          if (released || !Number.isSafeInteger(downloadId) || downloadId < 0) return;
          boundDownloadId = downloadId;
          requestedFilenamesByDownloadId.set(downloadId, requested);
        },
        release() {
          if (released) return;
          released = true;
          if (requestedFilenamesByUrl.get(url) === requested) requestedFilenamesByUrl.delete(url);
          if (
            boundDownloadId !== null &&
            requestedFilenamesByDownloadId.get(boundDownloadId) === requested
          ) {
            requestedFilenamesByDownloadId.delete(boundDownloadId);
          }
        },
      };
    },
  };
}

function noOpReservation(): PackDownloadFilenameReservation {
  return { bind() {}, release() {} };
}

function isOwnedBlobUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("blob:");
}

function isRequestedFilename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.includes("..")
  );
}

let installed: PackDownloadFilenameReassertion | null = null;

export function installPackDownloadFilenameReassertion(): PackDownloadFilenameReassertion {
  if (!installed) {
    installed = createPackDownloadFilenameReassertion(
      browser.downloads as unknown as FilenameDeterminationApi,
    );
  }
  return installed;
}

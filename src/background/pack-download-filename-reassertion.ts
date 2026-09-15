import { browser } from "wxt/browser";

type FilenameSuggestion = {
  conflictAction: "uniquify";
  filename: string;
};

export type FilenameDeterminationListener = (
  item: { id: number; url?: string },
  suggest: (suggestion?: FilenameSuggestion) => void,
) => void;

export interface FilenameDeterminationApi {
  onDeterminingFilename?: {
    addListener(listener: FilenameDeterminationListener): void;
  };
}

export interface PackDownloadFilenameReassertion {
  reserve(url: string, filename: string): PackDownloadFilenameReservation;
  reserveDataUrl(
    url: string,
    filename: string,
  ): { reservation: PackDownloadFilenameReservation; url: string };
}

export interface PackDownloadFilenameReservation {
  bind(downloadId: number): void;
  /**
   * Resolves `true` once `onDeterminingFilename` has been answered for this reservation, and
   * `false` if it has not within `timeoutMs`.
   *
   * A caller that releases as soon as `downloads.download()` resolves has released too early:
   * that promise settles when the download is *accepted*, and Chrome fires
   * `onDeterminingFilename` independently, routinely afterwards. The entry is then already gone
   * from both maps, the listener has nothing to re-assert, and the browser falls back to its own
   * generated name — correct bytes saved under the wrong name, in the wrong folder.
   *
   * Waiting is bounded rather than indefinite because the event is not guaranteed: another
   * extension can answer first, and Chrome does not fire it for every download. `false` means
   * "not answered in time", never "answered". Releasing after a `false` is the honest outcome —
   * the name was not re-asserted and the caller should not report that it was.
   */
  whenAnswered(timeoutMs?: number): Promise<boolean>;
  release(): void;
}

/**
 * How long a caller waits for `onDeterminingFilename` before giving up.
 *
 * Chrome blocks the download until a listener responds, so when the event fires at all it fires
 * within milliseconds. This is a generous ceiling, not a tuned value — but it is paid per download
 * by any caller that waits, so it is deliberately not larger. A caller that never gets the event
 * does not wait at all; see the `listening` short-circuit below.
 */
export const FILENAME_DETERMINATION_WAIT_MS = 500;

export function createPackDownloadFilenameReassertion(
  downloads: FilenameDeterminationApi | undefined,
): PackDownloadFilenameReassertion {
  type RequestedFilename = { filename: string; answered: () => void };
  // This is immediate event correlation, not run truth: callers reserve just before download()
  // and release at its terminal observation. Blob URLs must never enter durable extension storage.
  const requestedFilenamesByDownloadId = new Map<number, RequestedFilename>();
  const requestedFilenamesByUrl = new Map<string, RequestedFilename>();
  // Whether anything can ever answer. With no `onDeterminingFilename` to listen on -- an older
  // browser, a stripped permission, a test double that does not model the event -- no answer can
  // arrive, so waiting for one is a guaranteed timeout rather than a check. Distinguishing
  // "cannot be answered" from "not answered yet" is the difference between a fast, honest `false`
  // and a stall; a synthetic-demo run of ten files would otherwise pay the ceiling ten times over
  // for an event that was never going to come.
  const listening = typeof downloads?.onDeterminingFilename?.addListener === "function";

  downloads?.onDeterminingFilename?.addListener((item, suggest) => {
    const requested =
      requestedFilenamesByDownloadId.get(item.id) ??
      (item.url ? requestedFilenamesByUrl.get(item.url) : undefined);
    if (!requested) {
      suggest();
      return;
    }
    suggest({ conflictAction: "uniquify", filename: requested.filename });
    requested.answered();
  });

  return {
    reserve(url, filename) {
      if (!isOwnedBlobUrl(url) || !isRequestedFilename(filename)) return noOpReservation();
      return reserveOwnedUrl(url, filename);
    },
    reserveDataUrl(url, filename) {
      if (!isDataUrl(url) || !isRequestedFilename(filename)) {
        return { reservation: noOpReservation(), url };
      }
      const ownedUrl = `${url}#pack-download-${globalThis.crypto.randomUUID()}`;
      return { reservation: reserveOwnedUrl(ownedUrl, filename), url: ownedUrl };
    },
  };

  function reserveOwnedUrl(url: string, filename: string): PackDownloadFilenameReservation {
    // The executor runs synchronously, so `markAnswered` is the resolver by the time it is read.
    // The no-op initialiser exists to satisfy `exactOptionalPropertyTypes`, not as a fallback.
    let markAnswered: () => void = () => {};
    const answeredOnce = new Promise<true>((resolve) => {
      markAnswered = () => resolve(true);
    });
    const requested: RequestedFilename = { filename, answered: markAnswered };
    let boundDownloadId: number | null = null;
    let released = false;
    requestedFilenamesByUrl.set(url, requested);
    return {
      async whenAnswered(timeoutMs = FILENAME_DETERMINATION_WAIT_MS) {
        if (released || !listening) return false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            answeredOnce,
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), timeoutMs);
            }),
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      },
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
  }
}

function noOpReservation(): PackDownloadFilenameReservation {
  // Nothing was reserved, so nothing can be answered. Resolve immediately rather than making
  // every caller wait out a timeout for an event that cannot arrive.
  return { bind() {}, whenAnswered: async () => false, release() {} };
}

function isOwnedBlobUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("blob:");
}

function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:");
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

import {
  isPotentialDownloadCandidate,
  type DownloadObservationContext,
} from "./download-correlation";
import type { DownloadCreatedItem } from "./download-observer";

type FilenameConflictAction = "uniquify";
type FilenameSuggestion = { filename: string; conflictAction: FilenameConflictAction };
type SuggestCallback = (suggestion?: FilenameSuggestion) => void;

interface DownloadDeterminingFilenameEvent {
  addListener(listener: (item: DownloadCreatedItem, suggest: SuggestCallback) => void): void;
  removeListener(listener: (item: DownloadCreatedItem, suggest: SuggestCallback) => void): void;
}

export interface DownloadFilenameSuggestionApi {
  onDeterminingFilename?: DownloadDeterminingFilenameEvent;
}

export interface ActiveDownloadFilenameSuggestion {
  stop(): void;
}

export function suggestNextBrowserDownloadFilename(
  downloads: DownloadFilenameSuggestionApi,
  context: DownloadObservationContext,
  filename: string,
): ActiveDownloadFilenameSuggestion {
  const event = downloads.onDeterminingFilename;
  if (!event) return { stop: () => undefined };

  let active = true;

  function stop() {
    if (!active) return;
    active = false;
    event?.removeListener(onDeterminingFilename);
  }

  function onDeterminingFilename(item: DownloadCreatedItem, suggest: SuggestCallback) {
    if (!active) {
      suggest();
      return;
    }
    if (!isPotentialDownloadCandidate(item, context) || hasKnownNonMatchingMime(item, context)) {
      suggest();
      return;
    }

    suggest({ filename, conflictAction: "uniquify" });
    stop();
  }

  event.addListener(onDeterminingFilename);
  return { stop };
}

function hasKnownNonMatchingMime(
  item: DownloadCreatedItem,
  context: DownloadObservationContext,
): boolean {
  const mime = item.mime?.toLowerCase();
  if (!mime) return false;
  if (context.expectedMimeTypes.some((expected) => mime.includes(expected))) return false;
  if (isGenericAttachmentMime(mime)) return false;
  if (mime.startsWith("text/") || mime.startsWith("image/")) return true;
  return [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/zip",
  ].includes(mime);
}

function isGenericAttachmentMime(mime: string): boolean {
  return [
    "application/octet-stream",
    "binary/octet-stream",
    "application/download",
    "application/force-download",
    "application/x-download",
  ].includes(mime);
}

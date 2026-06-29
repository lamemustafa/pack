import {
  isExpectedDownloadCandidate,
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
    if (!isExpectedDownloadCandidate(item, context)) {
      suggest();
      return;
    }

    context.trustedDownloadIds?.add(item.id);
    suggest({ filename, conflictAction: "uniquify" });
    stop();
  }

  event.addListener(onDeterminingFilename);
  return { stop };
}

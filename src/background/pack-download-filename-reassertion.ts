import { browser } from "wxt/browser";

type FilenameSuggestion = {
  conflictAction: "uniquify";
  filename: string;
};

export type FilenameDeterminationListener = (
  item: { id: number },
  suggest: (suggestion: FilenameSuggestion) => void,
) => void;

export interface FilenameDeterminationApi {
  onDeterminingFilename?: {
    addListener(listener: FilenameDeterminationListener): void;
  };
}

export interface PackDownloadFilenameReassertion {
  release(downloadId: number): void;
  track(downloadId: number, filename: string): void;
}

export function createPackDownloadFilenameReassertion(
  downloads: FilenameDeterminationApi | undefined,
): PackDownloadFilenameReassertion {
  const requestedFilenames = new Map<number, string>();

  downloads?.onDeterminingFilename?.addListener((item, suggest) => {
    const filename = requestedFilenames.get(item.id);
    if (!filename) return;
    suggest({ conflictAction: "uniquify", filename });
  });

  return {
    release(downloadId) {
      requestedFilenames.delete(downloadId);
    },
    track(downloadId, filename) {
      if (!isRequestedFilename(filename)) return;
      requestedFilenames.set(downloadId, filename);
    },
  };
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

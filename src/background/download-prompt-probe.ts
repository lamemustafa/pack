import { browser } from "wxt/browser";
import type { DownloadPromptProbeResult } from "../core/messages";
import { observeBrowserDownloadById } from "./download-observer";
import {
  closeOffscreenBlobDocument,
  createOffscreenBlobUrl,
  revokeOffscreenBlobUrl,
} from "./offscreen-blob-url";

const PROBE_BODY = [
  "ComplyEaze Pack download prompt probe",
  "Synthetic local-only diagnostic bytes.",
  "No GST portal data is used.",
].join("\n");
const PROBE_FILENAME = "Pack-Diagnostics/download-prompt-probe.txt";
const PROBE_DATA_URL = `data:text/plain;charset=utf-8;base64,${base64Encode(PROBE_BODY)}`;

export async function runDownloadPromptProbe(
  sourceClass: DownloadPromptProbeResult["sourceClass"] = "data-url",
): Promise<DownloadPromptProbeResult> {
  const url = sourceClass === "offscreen-blob-url" ? await createProbeBlobUrl() : PROBE_DATA_URL;
  if (!url) {
    return {
      status: "start-rejected",
      filenameClass: "synthetic-download-prompt-probe",
      safeSignals: [
        "download-prompt-probe-start-rejected",
        "download-prompt-probe-save-as-false",
        "download-prompt-probe-offscreen-blob-url-rejected",
      ],
      safeMessage: "Pack could not prepare the synthetic offscreen Blob URL download prompt probe.",
      saveAsFalse: true,
      sourceClass,
    };
  }

  try {
    const downloadId = await browser.downloads.download({
      conflictAction: "uniquify",
      filename: PROBE_FILENAME,
      saveAs: false,
      url,
    });
    if (sourceClass === "offscreen-blob-url") {
      await observeBrowserDownloadById(
        browser.downloads,
        downloadId,
        {
          armedAt: new Date(),
          expectedFileExtensions: [".txt"],
          expectedMimeTypes: ["text/plain"],
          expectedOrigins: [],
          expectedUrlSubstrings: [],
          trustedDownloadIds: new Set([downloadId]),
        },
        5_000,
      );
    }

    return {
      status: "started",
      downloadId,
      filenameClass: "synthetic-download-prompt-probe",
      safeSignals: [
        "download-prompt-probe-started",
        "download-prompt-probe-save-as-false",
        `download-prompt-probe-source:${sourceClass}`,
      ],
      safeMessage:
        "Pack started a one-file extension-owned synthetic download prompt probe with saveAs:false.",
      saveAsFalse: true,
      sourceClass,
    };
  } catch {
    return {
      status: "start-rejected",
      filenameClass: "synthetic-download-prompt-probe",
      safeSignals: [
        "download-prompt-probe-start-rejected",
        "download-prompt-probe-save-as-false",
        `download-prompt-probe-source:${sourceClass}`,
      ],
      safeMessage:
        "Brave rejected the extension-owned download prompt probe before a download started.",
      saveAsFalse: true,
      sourceClass,
    };
  } finally {
    if (sourceClass === "offscreen-blob-url") {
      await revokeOffscreenBlobUrl(url);
      await closeOffscreenBlobDocument();
    }
  }
}

async function createProbeBlobUrl(): Promise<string | null> {
  return createOffscreenBlobUrl(PROBE_DATA_URL);
}

function base64Encode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export const CAPTURE_SUPPRESSION_SETTLE_MS = 1_000;
export const DEFAULT_CAPTURE_TRANSFER_CHUNK_SIZE = 512 * 1024;
export const MAIN_WORLD_CAPTURE_MESSAGE_SOURCE = "pack-main-world-capture-v1";
export const MAX_CAPTURE_TRANSFER_CHUNKS = 200;

export function escapeCaptureCss(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

export function isReadableBlob(value: unknown): value is Blob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Blob>;
  return (
    typeof candidate.size === "number" &&
    typeof candidate.type === "string" &&
    typeof candidate.arrayBuffer === "function"
  );
}

export function isPossibleArtifactContentType(contentType: string): boolean {
  const normalised = contentType.toLowerCase();
  return [
    "application/pdf",
    "application/octet-stream",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument",
  ].some((expected) => normalised.includes(expected));
}

export function splitCaptureDataUrlIntoChunks(
  capturedUrl: string,
  chunkSize: number,
): string[] | null {
  const chunks: string[] = [];
  for (let offset = 0; offset < capturedUrl.length; offset += chunkSize) {
    chunks.push(capturedUrl.slice(offset, offset + chunkSize));
  }
  return chunks.length > 0 && chunks.length <= MAX_CAPTURE_TRANSFER_CHUNKS ? chunks : null;
}

export function capturedPortalSafeSignals({
  filename,
  signalPrefix,
  source,
  suppressedWindowOpen,
}: {
  filename?: string | null | undefined;
  signalPrefix: string;
  source: "blob" | "data-url";
  suppressedWindowOpen: boolean;
}): string[] {
  const sourceSignals =
    source === "blob"
      ? [`${signalPrefix}-portal-blob-captured`, `${signalPrefix}-native-blob-click-suppressed`]
      : [
          `${signalPrefix}-portal-data-url-captured`,
          `${signalPrefix}-native-data-click-suppressed`,
        ];
  return [
    ...sourceSignals,
    `${signalPrefix}-main-world-capture`,
    ...(suppressedWindowOpen ? [`${signalPrefix}-native-window-open-suppressed`] : []),
    ...(filename ? [`${signalPrefix}-portal-filename-observed`] : []),
  ];
}

export function forEachEmbeddedCaptureUrl(text: string, callback: (url: string) => void): void {
  for (const [url] of text.matchAll(/\b(?:blob|data):[^"'<>\\\s)]+/g)) {
    callback(url);
  }
}

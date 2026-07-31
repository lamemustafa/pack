import type { DownloadCreatedItem } from "./download-observer";

export interface DownloadObservationContext {
  armedAt: Date;
  expectedFileExtensions: readonly string[];
  expectedMimeTypes: readonly string[];
  /** Direct endpoint downloads have no Pack-supplied filename to infer a type from. */
  requireExpectedMime?: boolean;
  trustedDownloadIds: ReadonlySet<number>;
}

export function isExpectedDownloadCandidate(
  item: DownloadCreatedItem,
  context: DownloadObservationContext,
): boolean {
  return (
    context.trustedDownloadIds.has(item.id) &&
    startsAfterArmedTime(item, context.armedAt) &&
    hasExpectedFileEvidence(item, context)
  );
}

function startsAfterArmedTime(item: DownloadCreatedItem, armedAt: Date): boolean {
  if (!item.startTime) return false;
  const startTime = Date.parse(item.startTime);
  return Number.isFinite(startTime) && startTime >= armedAt.getTime();
}

function hasExpectedFileEvidence(
  item: DownloadCreatedItem,
  context: DownloadObservationContext,
): boolean {
  const mime = item.mime?.toLowerCase();
  if (mime && context.expectedMimeTypes.some((expected) => mime.includes(expected))) return true;
  if (context.requireExpectedMime) return false;
  if (mime && isKnownNonMatchingMime(mime, context.expectedMimeTypes)) return false;

  const filename = item.filename;
  if (
    filename &&
    context.expectedFileExtensions.some((extension) => filename.toLowerCase().endsWith(extension))
  ) {
    return true;
  }

  const urls = [item.url, item.finalUrl]
    .filter(isNonNullableString)
    .map((value) => value.toLowerCase());
  if (
    urls.some((url) => context.expectedFileExtensions.some((extension) => url.includes(extension)))
  ) {
    return true;
  }

  return false;
}

function isKnownNonMatchingMime(mime: string, expectedMimeTypes: readonly string[]): boolean {
  if (expectedMimeTypes.some((expected) => mime.includes(expected))) return false;
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

function isNonNullableString(value: string | null | undefined): value is string {
  return typeof value === "string";
}

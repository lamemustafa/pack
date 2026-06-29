import type { DownloadCreatedItem } from "./download-observer";

export interface DownloadObservationContext {
  armedAt: Date;
  expectedOrigins: readonly string[];
  expectedFileExtensions: readonly string[];
  expectedMimeTypes: readonly string[];
  ignoredFilenames?: readonly string[];
}

export function isExpectedDownloadCandidate(
  item: DownloadCreatedItem,
  context: DownloadObservationContext,
): boolean {
  return isPotentialDownloadCandidate(item, context) && hasExpectedFileEvidence(item, context);
}

export function isPotentialDownloadCandidate(
  item: DownloadCreatedItem,
  context: DownloadObservationContext,
): boolean {
  if (!startsAfterArmedTime(item, context.armedAt)) return false;
  return hasExpectedOrigin(item, context.expectedOrigins);
}

function startsAfterArmedTime(item: DownloadCreatedItem, armedAt: Date): boolean {
  if (!item.startTime) return false;
  const startTime = Date.parse(item.startTime);
  return Number.isFinite(startTime) && startTime >= armedAt.getTime();
}

function hasExpectedOrigin(item: DownloadCreatedItem, expectedOrigins: readonly string[]): boolean {
  const origins = [item.url, item.finalUrl, item.referrer]
    .map((value) => (value ? parseOrigin(value) : null))
    .filter(isNonNullableString);
  return origins.some((origin) => expectedOrigins.includes(origin));
}

function hasExpectedFileEvidence(
  item: DownloadCreatedItem,
  context: DownloadObservationContext,
): boolean {
  const mime = item.mime?.toLowerCase();
  if (mime && context.expectedMimeTypes.some((expected) => mime.includes(expected))) return true;
  if (mime && isKnownNonMatchingMime(mime, context.expectedMimeTypes)) return false;

  const filename = item.filename;
  if (
    filename &&
    !isIgnoredFilename(filename, context.ignoredFilenames) &&
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

function isIgnoredFilename(
  filename: string,
  ignoredFilenames: readonly string[] | undefined,
): boolean {
  if (!ignoredFilenames?.length) return false;
  const candidates = filenameCandidates(filename);
  return ignoredFilenames.some((ignored) =>
    Array.from(filenameCandidates(ignored)).some((candidate) => candidates.has(candidate)),
  );
}

function filenameCandidates(filename: string): Set<string> {
  const normalised = filename.replace(/\\/g, "/").toLowerCase();
  const basename = normalised.split("/").pop() ?? normalised;
  return new Set([normalised, basename, stripUniquifier(normalised), stripUniquifier(basename)]);
}

function stripUniquifier(filename: string): string {
  return filename.replace(/\s+\(\d+\)(?=\.[^/.]+$)/, "");
}

function isNonNullableString(value: string | null | undefined): value is string {
  return typeof value === "string";
}

function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

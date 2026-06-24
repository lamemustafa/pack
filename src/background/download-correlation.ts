import type { DownloadCreatedItem } from "./download-observer";

export interface DownloadObservationContext {
  armedAt: Date;
  expectedOrigins: readonly string[];
  expectedFileExtensions: readonly string[];
  expectedMimeTypes: readonly string[];
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

  const filename = item.filename?.toLowerCase();
  if (
    filename &&
    context.expectedFileExtensions.some((extension) => filename.endsWith(extension))
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

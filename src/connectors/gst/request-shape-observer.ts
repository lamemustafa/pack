import type { PortalRequestShape } from "../../core/contracts";
import { SUPPORTED_GST_ORIGINS } from "./constants";

export interface RequestTimingLike {
  name: string;
  initiatorType: string;
  startTime: number;
}

const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const ARN_PATTERN = /\b[A-Z]{2}\d{13,}\b/g;
const OPAQUE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{18,}$/;

export function createSafeRequestShapes(
  entries: readonly RequestTimingLike[],
  currentOrigin: string,
): PortalRequestShape[] {
  if (!SUPPORTED_GST_ORIGINS.has(currentOrigin)) return [];

  const dedupe = new Map<string, PortalRequestShape>();

  for (const entry of entries) {
    const url = parseSameOriginGstUrl(entry.name, currentOrigin);
    if (!url) continue;

    const shape: PortalRequestShape = {
      connectorId: "gst",
      origin: url.origin,
      pathShape: sanitisePathShape(url.pathname),
      initiatorType: sanitiseInitiatorType(entry.initiatorType),
    };
    dedupe.set(`${shape.origin}|${shape.pathShape}|${shape.initiatorType}`, shape);
  }

  return [...dedupe.values()];
}

function parseSameOriginGstUrl(value: string, currentOrigin: string): URL | null {
  try {
    const url = new URL(value);
    if (url.origin !== currentOrigin) return null;
    if (!SUPPORTED_GST_ORIGINS.has(url.origin)) return null;
    return url;
  } catch {
    return null;
  }
}

function sanitisePathShape(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => sanitisePathSegment(segment))
    .join("/")
    .replace(GSTIN_PATTERN, "[redacted]")
    .replace(PAN_PATTERN, "[redacted]")
    .replace(ARN_PATTERN, "[redacted]");
}

function sanitisePathSegment(segment: string): string {
  if (!segment) return segment;
  const decoded = safeDecode(segment);
  if (
    GSTIN_PATTERN.test(decoded) ||
    PAN_PATTERN.test(decoded) ||
    ARN_PATTERN.test(decoded) ||
    OPAQUE_PATH_SEGMENT_PATTERN.test(decoded)
  ) {
    return "[opaque]";
  }
  return decoded
    .replace(GSTIN_PATTERN, "[redacted]")
    .replace(PAN_PATTERN, "[redacted]")
    .replace(ARN_PATTERN, "[redacted]");
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function sanitiseInitiatorType(value: string): string {
  return /^[a-z]+$/i.test(value) ? value.toLowerCase() : "unknown";
}

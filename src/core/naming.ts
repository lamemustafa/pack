const RESERVED_WINDOWS_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function sanitizeFileSegment(value: string, fallback = "pack"): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // eslint-disable-next-line no-control-regex -- control characters are invalid in Pack filenames.
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

  const safe = cleaned.length > 0 ? cleaned : fallback;
  return RESERVED_WINDOWS_NAMES.has(safe.toUpperCase()) ? `${safe}-file` : safe;
}

export function makeTargetId(parts: {
  documentType: string;
  financialYear?: string;
  period?: string;
  format?: string;
}): string {
  return [
    sanitizeFileSegment(parts.documentType.toLowerCase()),
    parts.financialYear ? sanitizeFileSegment(parts.financialYear.toLowerCase()) : undefined,
    parts.period ? sanitizeFileSegment(parts.period.toLowerCase()) : undefined,
    parts.format ? sanitizeFileSegment(parts.format.toLowerCase()) : undefined,
  ]
    .filter(Boolean)
    .join(":");
}

export function buildRelativePath(parts: {
  subjectLabel: string;
  financialYear: string;
  documentType: string;
  filename: string;
}): string {
  return [
    sanitizeFileSegment(parts.subjectLabel),
    sanitizeFileSegment(parts.financialYear),
    sanitizeFileSegment(parts.documentType),
    sanitizeFileSegment(parts.filename),
  ].join("/");
}

export function normalisePackFilename(value: string, extension: string): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "txt";
  return `${sanitizeFileSegment(value)}.${safeExtension}`;
}

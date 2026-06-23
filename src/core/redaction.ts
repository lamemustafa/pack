const SENSITIVE_PATTERNS = [
  /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g,
  /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  /\b\d{12}\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

export function redactSensitiveText(value: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[redacted]"),
    value,
  );
}

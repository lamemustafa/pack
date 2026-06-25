export const LIVE_RUN_SENSITIVE_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "gstin", pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i },
  { id: "pan", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/i },
  { id: "portal-url", pattern: /https:\/\/(?:www|services|return)\.gst\.gov\.in\/[^\s"']+/i },
  { id: "local-path", pattern: /(?:\/Users\/|[A-Z]:\\)[^\s"']+/i },
  {
    id: "filename",
    pattern: /\b[\w.-]*(?:gstr|gst|return)[\w.-]*\.(?:pdf|csv|xlsx?|zip)\b/i,
  },
  {
    id: "secret",
    pattern: /\b(?:cookie|authorization|x-csrf-token)\s*[:=]\s*[^\s;,"']+/i,
  },
  { id: "secret", pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*\b/i },
  { id: "portal-html", pattern: /<(?:html|body|script|table|form|input|select)\b/i },
];

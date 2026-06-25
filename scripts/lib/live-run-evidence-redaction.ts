export const LIVE_RUN_SENSITIVE_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "gstin", pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i },
  { id: "pan", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/i },
  { id: "arn", pattern: /\b[A-Z]{2}\d{13}\b/i },
  { id: "portal-url", pattern: /https:\/\/(?:www|services|return)\.gst\.gov\.in\/[^\s"']+/i },
  {
    id: "local-path",
    pattern:
      /(?:file:\/\/\/[^\s"']+|\/(?:Users|home|tmp|private\/tmp|var|workspace|root|opt|mnt|Volumes)\/[^\s"']+|[A-Z]:\\[^\s"']+)/i,
  },
  {
    id: "filename",
    pattern: /\b[\w.-]+\.(?:pdf|csv|xlsx?|zip)\b/i,
  },
  {
    id: "secret",
    pattern:
      /(?:\\?"(?:cookie|authorization|x-csrf-token|otp|captcha|password)\\?"|\b(?:cookie|authorization|x-csrf-token|otp|captcha|password)\b)\s*[:=]\s*\\?"?[^\s;,"'}]+/i,
  },
  { id: "secret", pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*\b/i },
  { id: "pdf", pattern: /(?:%PDF-\d(?:\.\d)?|application\/pdf|data:application\/pdf)/i },
  { id: "portal-html", pattern: /<(?:html|body|script|table|form|input|select)\b/i },
];

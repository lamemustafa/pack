export const LIVE_RUN_SENSITIVE_PATTERN_DEFINITIONS = [
  { id: "gstin", pattern: "\\b\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\\b", flags: "i" },
  { id: "pan", pattern: "\\b[A-Z]{5}\\d{4}[A-Z]\\b", flags: "i" },
  { id: "arn", pattern: "\\b[A-Z]{2}\\d{13}\\b", flags: "i" },
  {
    id: "portal-url",
    pattern: "https://(?:www|services|return|gstr2b)\\.gst\\.gov\\.in/[^\\s\"']+",
    flags: "i",
  },
  {
    id: "local-path",
    pattern:
      "(?:file:///[^\\s\"']+|/(?:Users|home|tmp|private/tmp|var|workspace|root|opt|mnt|Volumes)/[^\\s\"']+|[A-Z]:\\\\(?:Users\\\\)?[^\\s\"']+)",
    flags: "i",
  },
  { id: "filename", pattern: "\\b[\\w.-]+\\.(?:pdf|csv|xlsx?|zip)\\b", flags: "i" },
  {
    id: "secret",
    pattern:
      '(?:\\\\?"(?:cookie|authorization|x-csrf-token|otp|captcha|password)\\\\?"|\\b(?:cookie|authorization|x-csrf-token|otp|captcha|password)\\b)\\s*[:=]\\s*\\\\?"?[^\\s;,"\'}]+',
    flags: "i",
  },
  { id: "secret", pattern: "\\b(?:Bearer|Basic)\\s+[A-Za-z0-9._~+/-]+=*\\b", flags: "i" },
  {
    id: "pdf",
    pattern: "(?:%PDF-\\d(?:\\.\\d)?|application/pdf|data:application/pdf)",
    flags: "i",
  },
  { id: "portal-html", pattern: "<(?:html|body|script|table|form|input|select)\\b", flags: "i" },
];

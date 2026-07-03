const UNCONFIRMED_BROWSER_DOWNLOAD_SIGNALS = new Set([
  "browser-download-not-observed",
  "browser-download-size-unknown",
  "browser-download-interrupted",
  "browser-download-correlation-rejected",
  "browser-download-search-unavailable",
  "browser-download-search-missing",
  "browser-download-zero-bytes",
  "browser-download-zero-size",
  "filed-return-download-trigger-ambiguous",
  "filed-gstr3b-download-trigger-ambiguous",
]);

export function isUnconfirmedBrowserDownloadSignal(signal: string): boolean {
  return UNCONFIRMED_BROWSER_DOWNLOAD_SIGNALS.has(signal);
}

/**
 * Signals on which Pack deliberately will not retry a full-year target: a retry would ask the same
 * question and get the same answer, or would act on state Pack can no longer prove.
 *
 * One set for both full-year flows. The all-returns plan and the single-return run each withhold
 * their explicit retry on it, so a signal added here -- for example by a guard that refuses to
 * resume on another GST account -- withholds the retry in both, and the two cannot disagree about
 * which targets are worth retrying. Before this was shared, only the all-returns plan knew the
 * pinned-tab signal, and the single-return run offered a retry that landed the reader back on the
 * same blocked period.
 */
export const FILED_RETURNS_NON_RESUMABLE_EXPLICIT_RETRY_SIGNALS: ReadonlySet<string> = new Set([
  "all-supported-full-fiscal-year-artifact-snapshot-mismatch",
  "full-fiscal-year-pinned-gst-tab-unavailable",
  "single-period-bundle-ledger-malformed",
  "single-period-bundle-scope-conflict",
  "single-period-bundle-state-persist-failed",
  "single-period-bundle-state-read-failed",
  "filed-return-durable-status-rejected",
  // The portal's per-period filing preference; retrying asks the same question.
  "filed-gstr3b-quarterly-filer-unsupported",
]);

export function withholdsFiledReturnsExplicitRetry(signals: readonly string[]): boolean {
  return signals.some((signal) => FILED_RETURNS_NON_RESUMABLE_EXPLICIT_RETRY_SIGNALS.has(signal));
}

# Changelog

All notable changes to ComplyEaze Pack are documented here.

## 0.1.0 - 2026-06-23

- Initial Chrome MV3 V0 source alpha. No Chrome Web Store listing or approval is
  published yet.
- Local-first GSTR-3B PDF download workflow for supported GST Portal sessions.
- Synthetic reviewer demo that works without GST Portal credentials and writes
  demo manifest, index, and exception-report artifacts locally.
- Live GST PDF downloads do not yet write live manifest, index, or exception
  records.
- Extension storage is limited to install metadata, the active filed-returns run
  lease, the single-period target-review marker, the full fiscal year ledger,
  the last synthetic demo manifest summary, and temporary session workflow
  snapshots; the Options page clear-data control removes those Pack storage
  keys.
- The popup is now focused on live filed-return downloads; synthetic reviewer
  demo, last synthetic manifest, and broad local-data clearing controls live in
  Pack Options.
- CI pins third-party actions to commit SHAs, runs high-severity dependency
  audit, and prints the verified Chrome ZIP checksum as release evidence.
- Filed GSTR-3B final download clicks are now target-bound to the visible period
  and financial year, and the retryable navigation step no longer clicks the
  final portal download control.
- Full fiscal year download is available as a source-build alpha local
  per-period ledger. It remains outside Chrome Web Store readiness until durable
  restart/resume, positive not-filed evidence, live full-year QA, and privacy
  review gates are complete.
- Exact GST host permissions only.
- No ComplyEaze login, analytics, credential capture, cookie capture, or GST file
  upload in the local-download workflow.

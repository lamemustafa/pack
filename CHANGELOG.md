# Changelog

All notable changes to ComplyEaze Pack are documented here.

## 0.1.0 - 2026-06-24

- Initial Chrome MV3 V0 source alpha. No Chrome Web Store listing or approval is
  published yet.
- Local-first GSTR-3B PDF download workflow for supported GST Portal sessions.
- Synthetic reviewer demo that works without GST Portal credentials and writes
  demo manifest, index, and exception-report artifacts locally.
- Live GST PDF downloads do not yet write live manifest, index, or exception
  records.
- Extension storage is limited to install metadata, the last synthetic demo
  manifest summary, and temporary session workflow snapshots; the Options page
  clear-data control removes those Pack storage keys.
- Filed GSTR-3B final download clicks are now target-bound to the visible period
  and financial year, and the retryable navigation step no longer clicks the
  final portal download control.
- Full-financial-year bulk download selection is temporarily disabled until Pack
  has a durable per-period job ledger and completion inventory.
- Exact GST host permissions only.
- No ComplyEaze login, analytics, credential capture, cookie capture, or GST file
  upload in the local-download workflow.

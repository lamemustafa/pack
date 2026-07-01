# Changelog

All notable changes to ComplyEaze Pack are documented here.

## Unreleased

- Added Release Please-based version and changelog automation for reviewed
  release PRs.
- Added GitHub release asset publication for the verified Chrome ZIP, checksum,
  and release provenance JSON.
- Added protected Chrome Web Store submission workflows for future release
  updates.
- Updated public source metadata so the extension homepage points to
  `https://pack.complyeaze.com/gst`.

## [0.2.0](https://github.com/lamemustafa/pack/compare/v0.1.0...v0.2.0) (2026-07-01)


### Features

* add full fiscal year filed-return ledger ([16c9789](https://github.com/lamemustafa/pack/commit/16c97894fb293bfaf8a97d5db08070ea23c0de1c))
* **release:** automate Pack GitHub and Chrome Web Store releases ([#32](https://github.com/lamemustafa/pack/issues/32)) ([d551d14](https://github.com/lamemustafa/pack/commit/d551d141ec0f3174055e1ecc32d94f40ea00bbd1))


### Fixes

* bind filed-return downloads to verified targets ([70bf502](https://github.com/lamemustafa/pack/commit/70bf5028dfd57840f3c9d8a1c7c341c32ef16d0d))
* disable unsafe full-year filed return downloads ([0cd163c](https://github.com/lamemustafa/pack/commit/0cd163cf059c843d0ba13bc7814c9508599871d3))
* **download:** suggest filed-return download paths ([#26](https://github.com/lamemustafa/pack/issues/26)) ([94f0456](https://github.com/lamemustafa/pack/commit/94f045629a314773557d51b909217af128af0d41))
* **gst:** automate filed-return downloads without Save dialog ([#33](https://github.com/lamemustafa/pack/issues/33)) ([060324a](https://github.com/lamemustafa/pack/commit/060324a327d53191fbb42b7071598ddbf7aa5fdc))
* **gst:** harden filed returns portal flow ([#23](https://github.com/lamemustafa/pack/issues/23)) ([ab9d57b](https://github.com/lamemustafa/pack/commit/ab9d57bc6b5d9909cc91c9e2352786251ce0eca4))
* **gst:** harden filed-return downloads ([#24](https://github.com/lamemustafa/pack/issues/24)) ([47e42fd](https://github.com/lamemustafa/pack/commit/47e42fd9cb8511906f6a2ddebedb95e415c735f6))
* **gst:** harden Pack review follow-ups ([#25](https://github.com/lamemustafa/pack/issues/25)) ([78f9d3e](https://github.com/lamemustafa/pack/commit/78f9d3e8001024632b2435404eca21357ac6e1c4))
* harden filed-return download flow ([a6f8f2e](https://github.com/lamemustafa/pack/commit/a6f8f2ed13f6d089b3022cc71a0e913b85bf96c3))
* **recovery:** harden full-year retry and review gates ([0488399](https://github.com/lamemustafa/pack/commit/0488399b621b0f1232b9c97f9e8a503a5b8255c8))
* **release:** avoid disallowed release action ([bc7727f](https://github.com/lamemustafa/pack/commit/bc7727fc006997752fbcb0d334e484c2223f572a))
* **release:** close Pack release correctness gaps ([1becb1f](https://github.com/lamemustafa/pack/commit/1becb1f1774353e7c468237fe59069763c0295b6))
* **release:** harden Chrome Web Store publishing ([755c489](https://github.com/lamemustafa/pack/commit/755c489b7e07e23eac766f9d6df1edddd9eb7bdf))
* **release:** make release PRs pass Pack gates ([b85d17e](https://github.com/lamemustafa/pack/commit/b85d17e949cabab3732680723d7273d6f58efb46))
* **verify:** harden Pack harness policy gates ([#20](https://github.com/lamemustafa/pack/issues/20)) ([b2e0934](https://github.com/lamemustafa/pack/commit/b2e09349c97946a260247df3a024ad330f4f8f2f))


### Documentation

* harden Pack public-claim workflow ([#19](https://github.com/lamemustafa/pack/issues/19)) ([95d299a](https://github.com/lamemustafa/pack/commit/95d299af96037578060120870ff87f8b1611e7a3))
* tighten Pack agent guardrails ([#17](https://github.com/lamemustafa/pack/issues/17)) ([e657f39](https://github.com/lamemustafa/pack/commit/e657f395476cffbb3a4b33c8f646be23fee63aec))


### Tests

* **release:** load Pack ZIP in pinned Chromium ([#22](https://github.com/lamemustafa/pack/issues/22)) ([37a5fc3](https://github.com/lamemustafa/pack/commit/37a5fc3d2617958ec61d373efbf5d65b07d50114))


### Maintenance

* add Pack workflow preflight ([#18](https://github.com/lamemustafa/pack/issues/18)) ([7f3dac7](https://github.com/lamemustafa/pack/commit/7f3dac767181eb2a3f340a55da4ff26d2d161150))

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

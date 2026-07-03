## Docs Directory — Which File Governs Which Claim

Verified against actual `docs/` contents on 2026-07-03 — only real files listed.

| Claim / question type | Governing doc |
| --- | --- |
| Release cadence, tagging, ZIP/checksum/provenance flow, Chrome Web Store submission gating | `RELEASE.md` |
| Whether we can say "Chrome Web Store ready," "stable," or make broader public/durable claims | `PUBLICATION_READINESS.md` |
| Storage/permission/no-signup/local-first privacy claims, what the package verifier checks | `PRIVACY_QA.md` |
| Live GST Portal run evidence — what can be captured, redacted, and shared safely | `LIVE_EVIDENCE_PROTOCOL.md` |
| Scope/status of the private "View Filed Returns" live spike (not a public launch path) | `LIVE_FILED_RETURNS_SPIKE.md` |
| Review/rectify loop for any non-trivial code, docs, release, or governance change | `AGENT_REVIEW_RECTIFY.md` |
| Manual Chrome Web Store reviewer test steps (local demo, no real GST credentials) | `CHROME_REVIEWER_TEST.md` |
| Static asset (icon) used in docs | `assets/pack-icon.svg` |

Source-first rule: any public-facing copy (README, store listing, PR descriptions,
release notes) must match what `PUBLICATION_READINESS.md` currently allows — do not
upgrade a claim's strength based on this table alone; re-check the actual gates.

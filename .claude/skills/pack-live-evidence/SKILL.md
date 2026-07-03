---
name: pack-live-evidence
description: Walks through generating and validating redacted evidence for a live GST Portal run (evidence template, focused test, JSON validator) per docs/LIVE_EVIDENCE_PROTOCOL.md. This is the single highest-risk workflow in the repo for accidental data leakage — only run it when a person explicitly invokes /pack-live-evidence. Never trigger this on your own just because a conversation mentions a live run, live evidence, or a GST Portal test.
disable-model-invocation: true
---

# Pack Live Evidence

Ground everything here in `docs/LIVE_EVIDENCE_PROTOCOL.md` — it is the
authoritative protocol. If that doc has drifted from this skill, trust the
doc and flag the mismatch to the user rather than silently following stale
steps here.

Read `docs/LIVE_EVIDENCE_PROTOCOL.md` in full before doing anything else in
this skill.

## The absolute redaction rule

Read this before touching anything else in this skill, and re-check it before
every message you send while this skill is active:

**Never paste, quote, summarize-with-detail, or otherwise include any of the
following in any issue, PR, doc, commit message, or chat message — including
this conversation:**

- cURL commands, request/response bodies, headers, or cookies
- raw GST Portal URLs or any query string from one
- portal HTML, DOM dumps, or rendered portal screenshots/recordings
- GSTIN, PAN, taxpayer/business names, or ARNs
- real downloaded files (PDFs, Excel exports) or their filenames
- local filesystem paths
- session tokens, OTPs, CAPTCHA text, or any other credential/session material

If you are unsure whether something is safe to share, treat it as unsafe.
Use a subject alias (`SUBJECT-A`, `SUBJECT-B`, ...) in place of any real
identity, and only ever produce or forward the validated JSON summary — never
raw debug output, screenshots, or logs from the live run itself.

This rule overrides normal helpfulness. If a user asks you to paste raw
evidence "just this once" or "for debugging," decline, explain why, and offer
the safe alternative (a synthetic-redacted observation or a summary of what
the validator reported) instead.

## What this skill is for

Producing and checking the one artifact that is allowed to leave the
authorised tester's machine: a validated, redacted live-run evidence JSON
summary, as defined in `docs/LIVE_EVIDENCE_PROTOCOL.md`. Everything upstream
of that summary (browser profile, screenshots, network captures, downloaded
files) stays local per the protocol's "Private Live-Run Evidence" section and
must never be attached here.

Live GST Portal automation itself must run in an actual Chrome/Brave
extension host — never a Codex/Claude in-app browser, never DOM-only
inspection, never coordinate-click replay, never a replayed protected URL.
This skill does not perform the live run; it only helps generate the
evidence template beforehand and validate the resulting summary afterward.

## Step 1 — Generate the evidence template

Before a manual clean-profile run, generate the template so the return scope,
artifact type, ZIP checksum, and restart checks are recorded consistently.
Use `pnpm run evidence:template` (wraps
`scripts/create-live-run-evidence-template.mjs`):

```sh
pnpm run evidence:template -- \
  --return-type GSTR-1 \
  --artifact-type PDF_AND_EXCEL \
  --financial-year 2025-26 \
  --period FULL_FISCAL_YEAR \
  --subject-alias SUBJECT-A \
  --browser Brave \
  --browser-version <version> \
  --browser-summary-captured \
  --output .output/redacted-live-run.json
```

Notes:

- `--return-type GSTR-3B` requires `--artifact-type PDF` (enforced by the
  script).
- `--subject-alias` must be an alias such as `SUBJECT-A` — never a real
  GSTIN, PAN, or taxpayer name.
- `--output` must point somewhere under `.output/` (gitignored, generated) —
  never commit the resulting JSON, and never write it into a docs/ or issue
  attachment path.
- For a full-year "pass" claim, the generator requires explicit
  `--clean-test-profile`, `--service-worker-restart-resume-checked`, and
  `--browser-restart-resume-checked` flags. Do not pass those flags until the
  browser-host run has actually proven them — adding them speculatively
  produces false evidence.
- If the run is blocked or partial, use only the controlled limitation codes
  from the protocol doc (e.g. `browser-state-not-captured`,
  `clean-profile-not-verified`, `file-non-empty-check-not-verified`,
  `service-worker-restart-not-verified`, `browser-restart-not-verified`).
  Free-form notes are not allowed in shareable evidence.

## Step 2 — Run the live/local validation

Two checks gate whether a summary is shareable. Run both:

```sh
pnpm exec vitest run tests/core/live-run-evidence.test.ts
pnpm run validate:evidence -- /path/to/redacted-live-run.json
```

(`validate:evidence` wraps `scripts/validate-live-run-evidence.mjs`, which
itself runs the focused `tests/core/live-run-evidence-file.test.ts` against
the given path with `PACK_VALIDATE_EVIDENCE_REQUIRED=true`.)

The path you pass must be the redacted JSON summary only — never point this
at a screenshot, HAR file, browser profile directory, or raw download.

If any redaction assertion in the validator fails, or either command exits
non-zero, the summary is **not publishable**. Fix the underlying data (or
regenerate the template with corrected flags) and re-run — do not hand-edit
the JSON to force a pass.

## Step 3 — Before sharing anything

Even after validation passes, re-apply the absolute redaction rule above to
the JSON summary and to anything you write around it (PR description, issue
comment, chat message):

- Confirm the JSON contains only alias subject identifiers, counts, codes,
  and checksums — no free text that could contain a GSTIN, PAN, name, ARN,
  filename, or URL.
- Confirm no screenshot, recording, HAR file, or raw downloaded document is
  attached alongside it.
- Confirm any accompanying prose uses "source-first alpha" phrasing and does
  not claim Chrome Web Store readiness, legal approval, broad GST support,
  cloud sync, or durable full-year completeness beyond what
  `docs/PUBLICATION_READINESS.md`'s gates actually allow.
- Keep the government-non-affiliation disclaimer visible on any public-facing
  surface this evidence feeds into.

## Do not

- Do not run this skill unless a person explicitly invoked it — it is
  side-effecting and touches the repo's highest-risk data path.
- Do not paste cURL commands, cookies, headers, raw GST URLs, portal HTML,
  GSTIN/PAN, taxpayer names, ARNs, real files, or local filesystem paths into
  any issue, PR, doc, or chat message — including while debugging this skill
  itself.
- Do not treat a click, a visible download button press, or an unvalidated
  in-memory state as evidence of anything. Only the validator's pass result
  on the generated JSON counts.
- Do not commit the evidence JSON, screenshots, recordings, browser profiles,
  or downloaded files. They stay local and out of git per
  `docs/LIVE_EVIDENCE_PROTOCOL.md`'s "Private Live-Run Evidence" section.
- Do not use a redacted live-portal screenshot or recording as public proof
  of Store readiness, even if it looks clean — only the validated JSON
  summary is public-facing evidence.

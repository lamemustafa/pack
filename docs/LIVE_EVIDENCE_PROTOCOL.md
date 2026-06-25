# Live Evidence Protocol

Pack live-run evidence must prove only what can be shared safely. The public
record should be tamper-evident and reproducible for the build artifact, while
the GST Portal run remains a private authorised test with a signed redacted
summary.

## Evidence Layers

### Public Release Evidence

Publish these items with a release candidate:

- source commit and tag;
- exact Chrome ZIP SHA-256;
- CI build URL and package-verifier result;
- GitHub artifact attestation for the ZIP when available;
- SBOM or dependency-review evidence when available;
- redacted live-run evidence summary digest.

These items can be independently verified without exposing GST Portal data.

The current Pack CI policy pins actions by commit SHA and does not upload build
artifacts from pull requests. Add GitHub artifact attestation in a separate CI
hardening lane after pinning the `actions/attest` action. The intended public
verification command is:

```sh
gh attestation verify .output/<pack-chrome-zip> -R lamemustafa/pack
```

For a release candidate, publish the ZIP and checksum as GitHub Release assets,
then link the release, source commit, checksum, attestation status, and redacted
live-run evidence digest from the public source/status pages.

### Private Live-Run Evidence

Keep these local to the authorised tester unless counsel explicitly approves a
different retention path:

- downloaded GST PDFs or any derivative of them;
- live portal screenshots or recordings;
- raw browser profile data;
- network captures, HAR files, cookies, headers, tokens, or portal HTML;
- local file paths and filenames.

The public record should contain only the validated JSON summary accepted by
`validateLiveRunEvidence`.

## Screenshot And Video Rule

Screenshots and screen recordings of a live GST Portal session are private debug
artifacts, not public release evidence. Redaction can fail through missed text,
browser UI, filenames, hidden metadata, frame-by-frame leaks, OCR, or cache and
editing history. If a recording is needed for debugging:

1. use a clean browser profile;
2. capture the shortest useful segment;
3. do not include login, OTP, CAPTCHA, account selectors, taxpayer names, GSTIN,
   PAN, filenames, local paths, amounts, ARNs, cookies, request URLs, or PDF
   content;
4. store it outside git and release artifacts;
5. delete the raw capture after the redacted summary is accepted;
6. never use redacted live portal media as the public proof of Store readiness.

Synthetic demo screenshots and videos are allowed when generated from Pack demo
data and clearly labelled as synthetic.

## Brave Exploratory Run Summary

For a one-month or full-year exploratory run, record:

- exact source commit and ZIP SHA-256;
- browser name/version and clean-profile confirmation;
- subject alias such as `SUBJECT-A`, never GSTIN/PAN/name;
- scenario: `single-period` or `full-year`;
- outcome counts: eligible targets, downloaded, not filed, manually observed,
  blocked, failed, duplicates;
- human verification checks;
- service-worker and browser-restart checks for full-year runs;
- clear-local-data result;
- unexpected network destination count.

Run the focused validator test and then validate the local evidence file before
treating the summary as shareable:

```sh
pnpm exec vitest run tests/core/live-run-evidence.test.ts
PACK_LIVE_EVIDENCE_PATH=/path/to/redacted-live-run.json pnpm run validate:evidence
```

If any redaction assertion is true, the summary is not publishable.

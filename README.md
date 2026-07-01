# ComplyEaze Pack

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/lamemustafa/pack/actions/workflows/ci.yml/badge.svg)](https://github.com/lamemustafa/pack/actions/workflows/ci.yml)

ComplyEaze Pack is a local-first Chrome MV3 browser extension for collecting
compliance portal documents from an authorised browser session. V0 starts with
filed GSTR-3B PDFs from the GST Portal.

V0 is intentionally narrow:

- no ComplyEaze, Axal, or Pack login;
- no GST Portal credential, OTP, CAPTCHA, cookie, or session-token capture;
- no GST document upload in the local-download workflow;
- no extension analytics or telemetry;
- exact GST host permissions only;
- live local PDF downloads for selected filed GSTR-3B periods.

ComplyEaze Pack is an independent third-party tool. It is not affiliated with,
endorsed by, or operated by GSTN, CBIC, or the Government of India.

## Status

This public repository and the Chrome Web Store V0 listing are open-source
alpha surfaces. The extension has a local demo and a live GSTR-3B PDF download
path. Live manifest/index/exception-file generation is outside the current
alpha. Future store updates require the release gates in
[docs/PUBLICATION_READINESS.md](docs/PUBLICATION_READINESS.md) and
[docs/RELEASE.md](docs/RELEASE.md).
Release PR titles use Conventional Commits so Release Please can decide the
next Pack version from each merge.

Full fiscal year download is available in source-build alpha as a local
per-period ledger. It expands the selected financial year into eligible
GSTR-3B periods and runs them one at a time through the single-period path.
It remains outside store-facing claims until real-browser restart, resume, and
privacy-review gates are complete.

## Install

### Chrome Web Store

The V0 listing is available on the Chrome Web Store:

https://chromewebstore.google.com/detail/complyeaze-pack-gst-gstr/nfnbhekccajjfgkppolomflaeledoccb

Review the source, release notes, permissions, and privacy boundaries before
using Pack for GST records. The public Pack site is:

https://pack.complyeaze.com/gst

### From Source

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm exec wxt prepare
pnpm exec wxt build
```

Load the unpacked Chrome build from:

```text
.output/chrome-mv3
```

Use a separate Chrome profile for development or manual QA.

## Development

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
```

The full release gate is:

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
pnpm verify:clean
pnpm exec wxt zip
node scripts/verify-extension-zip.mjs
git diff --check
```

Package scripts are also available:

```sh
pnpm verify
pnpm verify:release
```

Direct commands are preferred in constrained agent terminals if chained package
scripts hang or hide failure details.

## Architecture

ComplyEaze Pack uses WXT, Vite, React, and TypeScript.

- `src/entrypoints/background.ts`: service worker, local demo downloads, and
  bounded filed-return PDF flow orchestration.
- `src/entrypoints/content.ts`: passive GST context detection.
- `src/entrypoints/popup`: React popup.
- `src/entrypoints/options`: React options page.
- `src/core`: portal-neutral contracts, manifest, naming, CSV, and messages.
- `src/connectors/gst`: GST-specific detection, GSTR-3B filed-return navigation,
  download triggering, and local demo data.
- `src/extension/manifest-policy.ts`: canonical extension metadata, permissions,
  host allow-list, CSP, homepage, and icons.
- `scripts/verify-extension-package.mjs`: built-package policy verification.

The reusable UCP-facing surface is the Pack plan/result/archive-manifest
contract, not shared credential or session handling. In the current alpha, that
contract is exercised by the local demo; the live GST path downloads PDFs without
persisting per-target `DownloadResult` records or a live manifest.

## Extension Storage

Pack uses Chrome extension storage only inside the current browser profile.

`chrome.storage.local`:

- `pack:install`: install/update metadata with product version, install
  timestamp, and `localOnly: true`;
- `pack:active-filed-returns-run`: a short-lived local run lease used to prevent
  overlapping filed-return downloads in the same browser profile;
- `pack:full-fiscal-year-ledger`: local-only full fiscal year run status with
  financial year, period, return type, target status, safe messages/signals,
  attempts, and timestamps only;
- `pack:filed-returns-target-review`: local-only single-period unresolved
  download review state with financial year, period, return type, safe
  messages/signals, and timestamps only;
- `pack:last-manifest`: the last local demo archive manifest summary. The live
  GST download path does not write a live manifest in this alpha.

`chrome.storage.session`:

- `pack:last-context`: the latest safe GST page support context;
- `pack:last-filed-returns-observation`: the latest safe filed-returns page
  observation;
- `pack:last-filed-returns-flow-summary`: the latest temporary filed-return flow
  status.

The Options page "Clear local Pack data" control removes the local keys above
and clears Pack session storage. Pack does not store GST Portal credentials,
OTPs, CAPTCHA values, cookies, GSTIN/PAN, taxpayer names, downloaded PDFs, portal
HTML, raw URLs/referrers, local download paths, filenames, or raw network
captures.

During a user-initiated live download, Pack temporarily observes browser download
metadata such as download ID, origin, MIME type, filename, start time, state, and
byte counts to decide whether the browser reported a non-empty GST Portal PDF.
This observation is bounded to the active run. Pack does not transmit this
metadata, and the current live path does not persist raw URLs, referrers,
absolute local paths, or filenames.

## Privacy Invariants

ComplyEaze Pack V0 must not:

- collect credentials, OTPs, CAPTCHA responses, cookies, or session tokens;
- upload GST files or document contents in the local-download workflow;
- access unrelated websites;
- use GST data for advertising, lending, creditworthiness, or profiling;
- load remote executable code.

Public issues, pull requests, screenshots, and support messages must not contain
real GSTIN, PAN, Aadhaar, taxpayer/client names, credentials, portal HTML, raw
network captures, or downloaded GST files.

## Release Notes And Reviewer Docs

- [Publication readiness](docs/PUBLICATION_READINESS.md)
- [Release runbook](docs/RELEASE.md)
- [Privacy QA](docs/PRIVACY_QA.md)
- [Chrome reviewer test instructions](docs/CHROME_REVIEWER_TEST.md)
- [Live filed returns spike notes](docs/LIVE_FILED_RETURNS_SPIKE.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[TRADEMARKS.md](TRADEMARKS.md) before opening issues or pull requests.

## License

Source code and documentation are licensed under the Apache License, Version 2.0.
See [LICENSE](LICENSE) and [NOTICE](NOTICE). ComplyEaze names, marks, logos,
icons, and official store identity are governed by [TRADEMARKS.md](TRADEMARKS.md).

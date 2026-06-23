# ComplyEaze Pack

ComplyEaze Pack is a local-first Chrome MV3 browser extension for downloading
filed GSTR-3B PDFs from an authorised GST Portal browser session.

V0 is intentionally narrow:

- no ComplyEaze, Axal, or Pack login;
- no GST Portal credential, OTP, CAPTCHA, cookie, or session-token capture;
- no GST document upload in the local-download workflow;
- no extension analytics or hidden telemetry;
- exact GST host permissions only;
- local manifest, index, and exception files for the selected job.

ComplyEaze Pack is an independent third-party tool. It is not affiliated with,
endorsed by, or operated by GSTN, CBIC, or the Government of India.

## Status

This repository is preparing for the first open-source and Chrome Web Store v0
release. The extension has a synthetic reviewer demo and a live GSTR-3B download
path, but public launch still requires the manual gates in
[docs/PUBLICATION_READINESS.md](docs/PUBLICATION_READINESS.md).

## Install

### Chrome Web Store

Coming soon after Chrome Web Store review and release sign-off.

### From Source

```sh
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
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
pnpm exec wxt zip
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
  bounded filed-return flow orchestration.
- `src/entrypoints/content.ts`: passive GST context detection.
- `src/entrypoints/popup`: React popup.
- `src/entrypoints/options`: React options page.
- `src/core`: portal-neutral contracts, manifest, naming, CSV, and messages.
- `src/connectors/gst`: GST-specific detection, GSTR-3B filed-return navigation,
  download triggering, and synthetic demo data.
- `src/extension/manifest-policy.ts`: canonical extension metadata, permissions,
  host allow-list, CSP, homepage, and icons.
- `scripts/verify-extension-package.mjs`: built-package policy verification.

The future UCP reuse surface is the Pack plan/result/archive-manifest contract,
not shared credential or session handling.

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

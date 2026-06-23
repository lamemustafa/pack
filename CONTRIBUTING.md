# Contributing To ComplyEaze Pack

Thank you for helping improve ComplyEaze Pack. This project handles sensitive
compliance workflows, so contributions must follow stricter privacy, security,
and review rules than an ordinary browser utility.

## Before Opening An Issue

Search existing issues and the compatibility matrix. Do not include:

- GSTIN, PAN, Aadhaar, taxpayer names, client names, or trade names;
- passwords, OTPs, CAPTCHA responses, cookies, session tokens, or credentials;
- ARNs, return values, tax amounts, downloaded GST files, or real filenames;
- screenshots containing taxpayer data;
- portal HTML, headers, cookies, or raw network captures from a real account.

Use synthetic values and the bundled demo environment. For a security
vulnerability, follow [SECURITY.md](SECURITY.md) and report privately.

## Development Setup

```sh
git clone https://github.com/lamemustafa/pack.git
cd pack
corepack enable
pnpm install --frozen-lockfile
pnpm exec wxt prepare
pnpm exec vitest run
pnpm exec wxt build
```

Load `.output/chrome-mv3` in a separate Chrome profile used only for development.

## Privacy And Security Invariants

A contribution must not:

- transmit GST data, URLs, filenames, or identifiers to a server;
- add analytics, crash reporting, ads, or session replay without an approved design;
- read credentials, OTPs, CAPTCHA responses, cookies, or session tokens;
- add `<all_urls>`, `history`, `cookies`, `webRequest`, `tabs`, or unrelated
  permissions without approval;
- load remote executable code;
- execute remote commands or selectors as code;
- log raw portal content;
- modify portal-original file bytes;
- use extension-acquired data for ads, credit, lending, or unrelated profiling.

## Changes Requiring A Design Issue First

Open a proposal before coding:

- a new portal or domain;
- a new browser permission;
- any network call from the extension;
- analytics, telemetry, crash reporting, or support upload;
- cloud upload or Axal import;
- authentication or credential features;
- changes to archive manifest semantics;
- remote configuration;
- a new runtime dependency with access to page data;
- changes to public legal, privacy, or store-listing wording.

## Pull Requests

A good pull request includes:

- problem and user impact;
- exact scope;
- tests;
- screenshots using synthetic data only, when UI changes;
- permission and data-flow impact;
- security considerations;
- documentation and changelog updates;
- signed-off commits.

Use DCO sign-off:

```text
Signed-off-by: Your Name <you@example.com>
```

By contributing, you agree that your contribution is licensed under Apache
License 2.0 and certify the DCO sign-off.

## Review Requirements

- One maintainer approval for ordinary changes.
- Two approvals, including a security/privacy owner, for sensitive areas.
- No direct pushes to protected branches.
- CI must pass formatting, lint, type checks, tests, build, and package-policy
  verification.

## Coding Guidance

- Use TypeScript strict mode.
- Validate all messages and unknown input.
- Use allow-lists, not block-lists, for portal metadata.
- Use stable, typed error codes.
- Do not include personal data in test fixtures.
- Prefer small dependencies and browser-native APIs.
- Avoid obfuscation and preserve reviewer readability.
- Keep portal-specific logic inside `src/connectors/<portal>`.

ComplyEaze and product marks remain subject to [TRADEMARKS.md](TRADEMARKS.md).

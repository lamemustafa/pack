# Pack Browser Extension Codebase

Pack is a WXT/Vite browser-extension repo nested inside ComplyEaze but managed as
its own git repository.

## Non-Negotiables

- V0 requires no Axal, Pulse, or ComplyEaze login.
- Do not collect, store, log, or transmit GST credentials, OTPs, CAPTCHA
  responses, cookies, tokens, or session material.
- Do not upload GST documents, GSTIN/PAN, ARNs, filenames, portal HTML, or tax
  metadata to ComplyEaze in normal V0 behavior.
- Do not add analytics, backend telemetry, remote selector configs, remote
  executable code, `externally_connectable`, or broad host permissions.
- Keep WXT manifest permissions to `downloads`, `scripting`, `storage`, and
  exact GST hosts unless a reviewed design issue approves the change.
- Keep shared contracts portal-neutral; keep GST logic in `src/connectors/gst`.
- Follow `docs/AGENT_REVIEW_RECTIFY.md` for non-trivial changes, review-rectify
  loops, release work, and logical commit segregation.

## Review And Release Posture

- Treat Pack as a public open-source browser extension for sensitive compliance
  workflows. Public source, docs, fixtures, generated artifacts, and release
  packages must not expose real taxpayer data, local credentials, session data,
  raw portal captures, or personal workstation paths.
- For Chrome extension behavior, verify assumptions against current official
  Chrome documentation before encoding rules around service-worker lifecycle,
  permissions, privacy declarations, downloads, storage, or Web Store policy.
- For open-source governance, keep SECURITY, contributing, issue templates,
  release checks, and CI aligned with GitHub/OpenSSF-style expectations.
- Default to review -> rectify -> re-review -> verify for meaningful changes.
  Continue until no Critical or High findings remain; document any remaining
  Medium/Low follow-ups explicitly.
- Commit in logical lanes. Keep generated artifacts, docs/governance, runtime
  code, tests, and release/package metadata separate unless a change is
  inseparable.

## Required Checks

Use:

```sh
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
```

`pnpm verify` is provided for normal terminals, but direct commands are preferred
inside Codex if package-script wrappers hang.

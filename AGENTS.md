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
- Keep WXT manifest permissions to `downloads`, `storage`, and exact GST hosts
  unless a reviewed design issue approves the change.
- Keep shared contracts portal-neutral; keep GST logic in `src/connectors/gst`.

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

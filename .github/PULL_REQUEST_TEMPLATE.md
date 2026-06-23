## Summary

## Scope

## Privacy And Data-Flow Impact

- [ ] No new browser permissions.
- [ ] No new host permissions.
- [ ] No new network calls.
- [ ] No analytics, telemetry, ads, or session replay.
- [ ] No credential, OTP, CAPTCHA, cookie, token, GST file, or taxpayer-data capture.
- [ ] Public copy and privacy declarations are updated if behaviour changed.

## Verification

- [ ] `pnpm exec wxt prepare`
- [ ] `pnpm exec prettier --check .`
- [ ] `pnpm exec eslint . --max-warnings 0`
- [ ] `pnpm exec tsc --noEmit`
- [ ] `pnpm exec vitest run`
- [ ] `pnpm exec wxt build`
- [ ] `node scripts/verify-extension-package.mjs .output/chrome-mv3`

## Screenshots

Use synthetic data only.

## DCO

- [ ] Commits include `Signed-off-by:` trailers.

# Pack Release Runbook

Pack releases are produced from the standalone extension repository, not from the
parent ComplyEaze app repository.

## Release gate

Run the full local release verification before tagging:

```sh
pnpm install --frozen-lockfile
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
pnpm exec wxt zip
```

The release gate covers:

- WXT type generation;
- Prettier formatting;
- ESLint;
- TypeScript;
- Vitest unit tests;
- Chrome MV3 production build;
- built-package permission, CSP, and remote-code checks;
- store ZIP creation.

## Manual clean-profile QA

Before submitting a ZIP to a browser store:

1. Load `.output/chrome-mv3` in a clean Chrome profile.
2. Confirm the permission prompt lists only GST Portal host access plus
   downloads/storage.
3. Open the popup outside GST domains and confirm the extension stays dormant.
4. Run the synthetic demo and confirm files are downloaded under `Pack-Demo/`.
5. Open the generated manifest and exceptions file and confirm all values are
   obviously synthetic.
6. Use the options page to clear local Pack data.
7. Reload the extension and confirm no previous synthetic manifest is shown.

Do not run live GST Portal automation for a public release candidate until legal
review and a current portal-compatibility pass have approved the exact behavior.

## Release artifact

Use WXT's generated Chrome ZIP from `.output/` as the store artifact. Publish the
source tag, ZIP checksum, and this release runbook together so reviewers can
reproduce the submitted build.

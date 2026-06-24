# Pack Release Runbook

Pack releases are produced from the standalone extension repository, not from the
parent ComplyEaze app repository.

## Release gate

Run the full local release verification before tagging:

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
pnpm exec wxt zip
node scripts/verify-extension-zip.mjs
git diff --check
```

The release gate covers:

- WXT type generation;
- Prettier formatting;
- high-severity dependency audit;
- ESLint;
- TypeScript;
- Vitest unit tests;
- Chrome MV3 production build;
- built-package permission, CSP, and remote-code checks;
- store ZIP creation;
- exact-ZIP extraction, package-policy verification, SHA-256 output, checksum
  file generation, and checksum log evidence in CI.

## PR Review Closure Before Tagging

Before tagging or producing the final store ZIP, verify that the release PR has
no unresolved post-merge review threads and that the latest Codex review applies
to the exact head that was merged:

```sh
pnpm review:gate -- --repo lamemustafa/pack --pr <number> --strict-head-review --required-review-author chatgpt-codex-connector --wait-head-review-ms 180000
```

Record the PR URL, head SHA, merge commit, and review-gate result in the release
notes. If Codex or another bot submits findings after merge, treat them as a
release blocker until fixed by a follow-up PR or answered with evidence.

The required CI `Review gate` workflow can pass after waiting for Codex when no
formal bot review is produced, because the external Codex reviewer is not a
deterministic CI service. Do not treat that as a store-readiness pass by itself.
For a release candidate, explicitly trigger `@codex review`, wait for the review
or document the missing-review gap, and keep the PR open for any later findings
before tagging.

## Manual clean-profile QA

Before submitting a ZIP to a browser store:

1. Load `.output/chrome-mv3` in a clean Chrome profile.
2. Confirm the permission prompt lists only GST Portal host access plus
   downloads/storage.
3. Open the popup outside GST domains and confirm the extension stays dormant.
4. Open Pack Options, run the synthetic demo, and confirm files are downloaded
   under `Pack-Demo/`.
5. Open the generated manifest and exceptions file and confirm all values are
   obviously synthetic.
6. Use the options page to clear local Pack data.
7. Reload the extension and confirm no previous synthetic manifest is shown.

Do not run live GST Portal automation for a public release candidate until legal
review and a current portal-compatibility pass have approved the exact behavior.

## Release artifact

Use WXT's generated Chrome ZIP from `.output/` as the store artifact only after
`node scripts/verify-extension-zip.mjs` extracts that exact ZIP, reruns the
package verifier against the extraction, and prints the checksum. Publish the
source tag, release ZIP artifact, ZIP checksum, and this release runbook together
so reviewers can reproduce the submitted build.

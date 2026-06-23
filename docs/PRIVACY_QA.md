# Pack Privacy QA

Pack V0 must stay local-first and no-signup.

## Automated checks

The package verifier fails the build when:

- forbidden permissions are present, including `cookies`, `history`,
  `webRequest`, `tabs`, `identity`, `alarms`, native messaging, clipboard access,
  or unlimited storage;
- host permissions broaden beyond GST Portal domains;
- `<all_urls>` appears;
- `externally_connectable` is declared;
- extension-page CSP does not restrict scripts and objects to `self`;
- CSP allows `unsafe-eval`;
- built JavaScript/HTML/CSS/JSON contain remote executable-code patterns;
- Pack source code contains sensitive credential markers.

## Manual checks

For each release candidate:

- Inspect `src/extension/manifest-policy.ts` and the built
  `.output/chrome-mv3/manifest.json`.
- Confirm no analytics, crash-reporting, ad, lender, or cloud-upload SDK is
  installed.
- Confirm all demo data is synthetic and visibly labelled as synthetic.
- Confirm no source file handles passwords, OTPs, CAPTCHA responses, cookies, or
  session tokens.
- Confirm the privacy policy, store declarations, and reviewer instructions
  still match actual runtime behavior.

Any server communication, new portal host, credential handling, analytics,
cloud upload, or account requirement is a material privacy change and needs a
fresh product, legal, security, and store-review pass.

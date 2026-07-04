# Chrome Web Store Asset Sources

These source assets are safe drafts for the `v0.3.1` Chrome Web Store dashboard
update. They are not proof that the Store update is live.

The asset dimensions follow Chrome's official "Supplying Images" guidance:

- extension icon: 128x128 PNG in the extension ZIP;
- small promotional image: 440x280 pixels;
- optional marquee promotional image: 1400x560 pixels;
- screenshots: 1280x800 or 640x400 pixels.

Reference: <https://developer.chrome.com/docs/webstore/images>

## Synthetic Data Rule

Do not use real GST Portal screenshots, taxpayer names, GSTIN/PAN values,
filenames, local download paths, portal HTML, cookies, headers, OTPs, CAPTCHA
content, or downloaded GST files in Store assets.

The SVGs in this directory use synthetic UI shapes and redacted labels only.
Export dashboard uploads from these sources after visual QA, then record the
exported file hash and dashboard review state in
[`../listing.md`](../listing.md).

## Asset Sources

| Source file                               | Intended export                   |
| ----------------------------------------- | --------------------------------- |
| `small-promo-440x280.svg`                 | 440x280 small promotional PNG     |
| `marquee-promo-1400x560.svg`              | 1400x560 optional marquee PNG     |
| `screenshot-local-downloads-1280x800.svg` | 1280x800 synthetic screenshot PNG |

The Chrome Web Store package/listing update for `v0.3.1` remains pending until
the exported assets, package upload, privacy declarations, reviewer
instructions, review result, and publication state are recorded for the exact
release.

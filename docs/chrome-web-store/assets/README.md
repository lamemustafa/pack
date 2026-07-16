# Chrome Web Store Asset Sources And Exports

These source assets and generated exports are the safe synthetic asset set for
the `v0.4.0` Chrome Web Store dashboard update. They use the current Pack popup
visual language as a reference while intentionally excluding real GST Portal
screenshots and taxpayer data. Store publication is recorded in
[`../listing.md`](../listing.md); these files remain source-controlled inputs,
not dashboard-held proof.

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

The SVGs in this directory use synthetic UI shapes and safe labels only. The
user-supplied Pack popup screenshots are design references and are not copied,
committed, or exported as Store assets.
Export dashboard uploads from these sources with:

```sh
pnpm store:assets
```

The exporter writes PNG uploads and `asset-hashes.json` under `exports/`. Re-run
it after any SVG source edit, visually QA the generated PNGs, then record the
dashboard review state in [`../listing.md`](../listing.md).

## Asset Sources

| Source file                                  | Intended export                         |
| -------------------------------------------- | --------------------------------------- |
| `small-promo-440x280.svg`                    | 440x280 small promotional PNG           |
| `marquee-promo-1400x560.svg`                 | 1400x560 optional marquee PNG           |
| `screenshot-local-downloads-1280x800.svg`    | 1280x800 GSTR-1 synthetic screenshot    |
| `screenshot-gstr3b-summary-pdf-1280x800.svg` | 1280x800 GSTR-3B synthetic screenshot   |
| `screenshot-local-review-state-1280x800.svg` | 1280x800 review-state screenshot        |
| `screenshot-options-clear-data-1280x800.svg` | 1280x800 local privacy controls         |
| `screenshot-reviewer-demo-1280x800.svg`      | 1280x800 local reviewer demo screenshot |

## Generated Exports

`exports/asset-hashes.json` is the authoritative generated inventory. It records
each PNG's source, exact dimensions, and SHA-256. Re-export and review that
manifest whenever any source SVG changes; do not duplicate hashes manually in
this README.

For each Store release, keep the exported assets, package upload, privacy
declarations, reviewer instructions, review result, and publication state tied
to the exact release version.

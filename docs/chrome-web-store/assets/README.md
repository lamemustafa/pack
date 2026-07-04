# Chrome Web Store Asset Sources And Exports

These source assets and generated exports are safe drafts for the `v0.3.2`
Chrome Web Store dashboard update. They are not proof that the Store update is
live.

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
Export dashboard uploads from these sources with:

```sh
pnpm store:assets
```

The exporter writes PNG uploads and `asset-hashes.json` under `exports/`. Re-run
it after any SVG source edit, visually QA the generated PNGs, then record the
dashboard review state in [`../listing.md`](../listing.md).

## Asset Sources

| Source file                               | Intended export                   |
| ----------------------------------------- | --------------------------------- |
| `small-promo-440x280.svg`                 | 440x280 small promotional PNG     |
| `marquee-promo-1400x560.svg`              | 1400x560 optional marquee PNG     |
| `screenshot-local-downloads-1280x800.svg` | 1280x800 synthetic screenshot PNG |

## Generated Exports

| Export file                                       | Dimensions | SHA-256                                                            |
| ------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `exports/small-promo-440x280.png`                 | 440x280    | `dd2be16f7f660fc5d6222dfd22cc64443cfc86df95c3ecdaed8ccee39d3461dd` |
| `exports/marquee-promo-1400x560.png`              | 1400x560   | `a9e387d317e2ff66ab6357a0b142852f2980a8fa31642e3e9a4b32620fd8ac98` |
| `exports/screenshot-local-downloads-1280x800.png` | 1280x800   | `76b5917b8c3e2d516f4a9d293078989b035e529306527c11058003c505339e8e` |
| `exports/asset-hashes.json`                       | manifest   | recorded in source with the export set                             |

The Chrome Web Store package/listing update for `v0.3.2` remains pending until
the exported assets, package upload, privacy declarations, reviewer
instructions, review result, and publication state are recorded for the exact
release.

# Chrome Web Store Listing

This file is the source-controlled listing brief for the Chrome Web Store
dashboard. Package upload and publish are automated separately; dashboard
listing text, screenshots, promo assets, and privacy-practices fields must still
be reviewed in the Chrome Web Store Developer Dashboard.

Use [`dashboard-closeout.md`](dashboard-closeout.md) for the manual dashboard
upload, privacy-practices, reviewer-instructions, and read-only status-monitor
steps that remain after the protected package submit workflow succeeds.

## Current Public Listing

- Status: V0 listing available for the existing published package.
- Verified source release: GitHub
  [`v0.3.2`](https://github.com/lamemustafa/pack/releases/tag/v0.3.2)
  includes GSTR-1 support. The Chrome ZIP asset is
  `https://github.com/lamemustafa/pack/releases/download/v0.3.2/complyeazepack-0.3.2-chrome.zip`
  with SHA-256
  `6bd41a364a2466f0f255bef1b44e93694cc8d95431e7661fea5be3d52c9cdddb`.
- Package update: the `v0.3.2` package was submitted through protected workflow
  dispatch on 2026-07-04. Run `28704776806` uploaded the verified package with
  upload state `SUCCEEDED`, publish state `PENDING_REVIEW`, and no warnings.
- Required dashboard update: upload/review listing copy, screenshots,
  promotional image, privacy-practices declarations, and reviewer instructions
  in the Chrome Web Store Developer Dashboard.
- Publication state: the `v0.3.2` package update is pending Chrome Web Store
  review/publication. Dashboard listing/assets review state is not recorded yet.
- External boundary: no official, GSTN-approved, filing, reconciliation, all GST
  returns, backend sync, or professional-review claim.

## Recommended Store Copy

Title:

```text
ComplyEaze Pack: GSTR-1/GSTR-3B Downloader
```

Short description:

```text
Alpha: locally download filed GSTR-1 and GSTR-3B documents from your active GST Portal session.
```

Opening description:

```text
ComplyEaze Pack helps authorised users locally download filed GSTR-3B PDFs,
filed GSTR-1 summary PDFs, and optional GSTR-1 e-invoice details Excel files
from an active GST Portal browser session. It does not ask for or store GST
Portal credentials, OTPs, CAPTCHA responses, cookies, or session tokens.
```

Required disclaimer:

```text
ComplyEaze Pack is an independent third-party tool. It is not affiliated with,
endorsed by, or operated by GSTN, CBIC, or the Government of India.
```

## Release Evidence For Dashboard Update

| Item                  | Evidence                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Source tag            | [`v0.3.2`](https://github.com/lamemustafa/pack/releases/tag/v0.3.2)                                                       |
| Source commit         | `7bc2c2604f045c1d5547f6ab63a84dbb91de161e`                                                                                |
| Chrome ZIP asset      | `complyeazepack-0.3.2-chrome.zip`                                                                                         |
| Chrome ZIP SHA-256    | `6bd41a364a2466f0f255bef1b44e93694cc8d95431e7661fea5be3d52c9cdddb`                                                        |
| Release workflow      | GitHub Actions run `28702352034`; package, exact-ZIP verification, provenance, and GitHub release asset upload passed.    |
| Store dry-run         | GitHub Actions run `28704697827`; downloaded and verified `v0.3.2` release assets and produced a dry-run publish request. |
| Store package submit  | GitHub Actions run `28704776806`; upload state `SUCCEEDED`, publish state `PENDING_REVIEW`, warnings `[]`.                |
| Store publication gap | Chrome Web Store review/publication and dashboard listing/assets review state are not recorded yet.                       |

## Asset Inventory

Committed brand and icon assets:

| Asset                                 | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `public/brand/pack-logo.svg`          | `be48b4275f5f8352b6eaacab2e7921530fa57844c361673c4e1072b80822cbfb` |
| `public/brand/pack-logo-reversed.svg` | `307ff5d7aea758f85282befa1cf5e7c4e29a6e39c286c34f070264571de8a87e` |
| `public/brand/pack-icon.svg`          | `89938003655923e2c9a777093bb65223e3eab39deab28ad11fa6a2e1ccaaa67a` |
| `public/icons/icon-128.png`           | `3a5d56c19e499ac6d51579589fb867449cad3ce0926fe57bcdc3a9203aa08f26` |
| `public/icons/icon-256.png`           | `aec654f6dda6525fdbb03448c99e917a8143332c3e2d1b1bb4ccded83cc5c2c6` |
| `public/icons/icon-512.png`           | `6380a02494c5da2c1cd4297dcfb5bc53448d95cd117d804c5a5d38f1f390def3` |

Synthetic source-controlled Store asset drafts:

| Asset                                                                     | Intended dashboard slot        | Notes                                     |
| ------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------- |
| `docs/chrome-web-store/assets/small-promo-440x280.svg`                    | Small promotional image source | Synthetic, no portal/account data.        |
| `docs/chrome-web-store/assets/marquee-promo-1400x560.svg`                 | Optional marquee image source  | Synthetic, no portal/account data.        |
| `docs/chrome-web-store/assets/screenshot-local-downloads-1280x800.svg`    | Screenshot source              | Synthetic GSTR-1 PDF/Excel view.          |
| `docs/chrome-web-store/assets/screenshot-gstr3b-summary-pdf-1280x800.svg` | Screenshot source              | Synthetic GSTR-3B PDF view.               |
| `docs/chrome-web-store/assets/screenshot-local-review-state-1280x800.svg` | Screenshot source              | Synthetic local target-review state.      |
| `docs/chrome-web-store/assets/screenshot-options-clear-data-1280x800.svg` | Screenshot source              | Synthetic local storage/privacy controls. |
| `docs/chrome-web-store/assets/screenshot-reviewer-demo-1280x800.svg`      | Screenshot source              | Synthetic reviewer demo output.           |

Generated Store dashboard PNG exports:

| Asset                                                                             | Intended dashboard slot | SHA-256                                                            |
| --------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| `docs/chrome-web-store/assets/exports/small-promo-440x280.png`                    | Small promotional image | `dd2be16f7f660fc5d6222dfd22cc64443cfc86df95c3ecdaed8ccee39d3461dd` |
| `docs/chrome-web-store/assets/exports/marquee-promo-1400x560.png`                 | Optional marquee image  | `a9e387d317e2ff66ab6357a0b142852f2980a8fa31642e3e9a4b32620fd8ac98` |
| `docs/chrome-web-store/assets/exports/screenshot-local-downloads-1280x800.png`    | Screenshot              | `76b5917b8c3e2d516f4a9d293078989b035e529306527c11058003c505339e8e` |
| `docs/chrome-web-store/assets/exports/screenshot-gstr3b-summary-pdf-1280x800.png` | Screenshot              | `16b47ddaf6426614947ae855529182f7980373d03c3517cf964d79c89fde599e` |
| `docs/chrome-web-store/assets/exports/screenshot-local-review-state-1280x800.png` | Screenshot              | `39a74caa403ec96c2d6fe2850163145ee6a99fcfa692eeac0927bfb2e1db364a` |
| `docs/chrome-web-store/assets/exports/screenshot-options-clear-data-1280x800.png` | Screenshot              | `b10bca84078df36b62f864827e157dda0b063b845812bfe0c8c93359db003d15` |
| `docs/chrome-web-store/assets/exports/screenshot-reviewer-demo-1280x800.png`      | Screenshot              | `02a599565c113e83d7b47283946143f190a43f214f846188de4547853482338b` |
| `docs/chrome-web-store/assets/exports/asset-hashes.json`                          | Export manifest         | Tracks file names, dimensions, sources, and SHA-256 hashes.        |

Chrome's current image guidance is recorded in
[`docs/chrome-web-store/assets/README.md`](assets/README.md). Export dashboard
uploads from the source assets only after visual QA confirms the generated PNGs
remain legible and contain no real GST Portal/account data. The current PNG
exports were generated with `pnpm store:assets` and visually checked as
synthetic/redacted source-controlled assets; the Chrome Web Store dashboard still
needs the actual upload and review-state evidence.

Dashboard-held items that still need review before GSTR-1 store-facing claims:

- Upload the generated screenshot and promotional PNG exports to the dashboard.
- Record Chrome Web Store image/listing review state for the uploaded exports.
- Privacy-practices declarations aligned with `docs/PRIVACY_QA.md`.

# Chrome Web Store Listing

This file is the source-controlled listing brief for the Chrome Web Store
dashboard. Package upload and publish are automated separately; dashboard
listing text, screenshots, promo assets, and privacy-practices fields must still
be reviewed in the Chrome Web Store Developer Dashboard.

## Current Public Listing

- Status: V0 listing available for the existing published package.
- Required update: next Release Please patch listing copy and package review for
  GSTR-1 support.
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

Dashboard-held assets that still need review before GSTR-1 store-facing claims:

- Store screenshots using synthetic or redacted data only.
- Promotional tiles if the dashboard requires them.
- Privacy-practices declarations aligned with `docs/PRIVACY_QA.md`.

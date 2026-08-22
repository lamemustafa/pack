# Brand Direction

## Current Read

The current mark tries to say too many things at favicon scale: documents, archive/folder, zipper,
and completed badge. In the source assets, the standalone mark has 12 paths and one circle, while
the favicon/extension icon has six paths, two circles, and a rounded square. The header logo uses a
third construction: a compact mark plus outlined word paths.

That creates three problems:

- The small icon is detailed, so the check and zipper compete below 32 px.
- The dominant 16 px color is deep navy. It reads clearly on a light toolbar, but blends into a
  dark toolbar.
- ComplyEaze appears as wordmark baggage instead of a clean endorsement. Pack should be the product
  identity; ComplyEaze should be the trust parent.

The current broader logo in `public/brand/pack-logo.svg` also uses a document/download metaphor
while the extension icon uses a folder/zipper metaphor. Both are defensible, but together they make
the brand feel unsettled.

## Direction A: Ledger P

File: `03-wireframes/marks/pack-mark-ledger.svg`

Use a bold Pack "P" built from a ledger page, with one target-bound check. This preserves the
document/evidence idea while removing the zipper and stacked-paper detail. It is the best direction
for small toolbar visibility because the silhouette is a letter, not an illustration.

Lockup rule:

- Primary: Pack mark + "Pack"
- Secondary endorsement: "by ComplyEaze" at 65-75% of Pack's text size
- Do not put ComplyEaze in the same weight or color as Pack.

## Direction B: Target Archive

File: `03-wireframes/marks/pack-mark-target.svg`

Use a simplified archive shape inside target corners. This keeps the "local pack of files" idea
but makes target binding the memorable element. It is more literal than Direction A and may work
better if Pack wants to remain visibly about saved files rather than become a broader compliance
workbench.

Lockup rule:

- Icon stands alone in browser toolbar.
- In product surfaces, pair with "Pack" and one quiet line: "by ComplyEaze."
- Use ComplyEaze blue as endorsement/accent only. Do not use Axal-reserved purple.

## Color Rule

Avoid the current all-blue identity becoming generic. Keep the base navy for trust, add one
operational accent:

- Navy: Pack/product identity and primary action.
- Teal: confirmed local evidence.
- Amber: review required.
- Red: dangerous reset or unrecoverable failure.

Do not use decorative gradients. If the mark needs more contrast on dark toolbars, prefer a light
outline or lighter field variant rather than adding more internal detail.

## Recommendation

Pick Direction A for the extension icon and favicon. It has the strongest silhouette at 16 px and
lets the product grow beyond "zip downloads" without abandoning the local evidence story.

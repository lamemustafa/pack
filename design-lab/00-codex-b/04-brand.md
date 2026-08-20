# UX-B brand direction

## Independent assessment

The current mark is a good 128 px illustration and a weak toolbar glyph. It combines a folder or
document stack, zipper, and check. At 32 px the metaphor is busy; at 16 px the internal proof/check
detail is no longer reliably legible. The fix is not to enlarge the same composition but to reduce
it to one silhouette and one secondary signal.

The asserted June critique archive was not present in the parent design material available to this
audit. Only the canonical token file was present, and its history contained no critique directory.
The claimed 29/40 score and priorities therefore could not be reproduced and did not influence the
recommendation.

The parent token source explicitly reserves Axal purple for Axal-only use. Neither direction uses
purple.

## Direction A — Bound sheet (recommended)

`03-wireframes/marks/direction-a.svg`

A single sheet silhouette with a strong horizontal binding band. It reads as "a file made into a
pack" without zipper teeth, miniature checks, or several document layers. The navy tile preserves
contrast on both light and dark toolbars; the teal band is an accent, not the silhouette.

Why it wins:

- recognisable at 16 px through a solid outer shape and one internal division;
- connects "file" and "pack" without suggesting upload, cloud, or government identity;
- supports a one-color fallback by merging the band into a knock-out line;
- visually quieter beside dense operational UI.

Risk: a bound sheet can resemble a generic document app. The wordmark and consistent teal band must
carry distinctiveness; do not add small proof symbols to compensate.

## Direction B — Evidence bundle

`03-wireframes/marks/direction-b.svg`

Three broad evidence bars held by one strap inside a circular field. It emphasizes collection and
ordered evidence rather than a literal file.

Why it remains viable:

- exceptionally stable at 16 px;
- communicates aggregation and sequence;
- works as a monochrome toolbar mask.

Risk: it is more abstract and can read as a list/database mark at larger sizes. It is the stronger
system icon but the weaker product story.

## Size and toolbar proof

`03-wireframes/marks/index.html` renders both source SVGs at 128, 32, and 16 px on simulated light
and dark Chrome toolbars. The source remains a 128-unit vector; do not auto-simplify separate raster
sizes. Before shipping, produce pixel-snapped 16/32/48/128 raster exports and compare them in an
actual extension menu at 1x and 2x density.

## Lockup rule

Primary lockup:

> **Pack** from ComplyEaze

- `Pack` is the product word and takes 100% optical emphasis.
- `from ComplyEaze` is a provenance line at 42–48% of Pack's cap height, regular weight, neutral
  ink, and at least one `P`-stem of separation.
- ComplyEaze never receives the teal accent when it appears beside Pack; the mark already owns the
  accent.
- At toolbar size, use the mark alone. At 32 px or more, use `Pack`; add provenance only when the
  total lockup is at least 120 px wide.
- Never write the two names at equal size/weight or combine their marks. Endorsement should increase
  trust without turning the surface into two competing brands.

## Type direction

Do not solve rendering drift merely by replacing Inter with another fashionable face. The first
implementation decision is binary:

1. use a deliberate system stack and a four-weight token set (400/600/700/800), accepting platform
   variation; or
2. ship one audited variable font subset and accept package/license cost.

For this local-first extension, the first option is the lower-risk default. The distinctive identity
should come from the mark, language, spacing, and evidence-led status system—not six heavy weights.

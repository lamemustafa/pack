# Brand — Claude pass

## Why the current mark fails, measured

The mark contains six ideas: three stacked documents, an archive pouch, a zipper spine, zipper
teeth, a pull-tab, and a check badge. Every one of them is a picture of _how Pack works_, and
mechanism is the first thing to die at toolbar size.

Two measurements, both from rasterising the shipped assets to a canvas:

| Asset               |  Opaque px | Distinct colours |
| ------------------- | ---------: | ---------------: |
| `icons/icon-16.png` |  192 / 256 |           **68** |
| `icons/icon-32.png` | 840 / 1024 |              119 |

Sixty-eight colours across 192 pixels is one new colour per three pixels — antialiasing, not a
palette.

| Colour           | Share of opaque px | vs light toolbar | vs dark toolbar `rgb(32,33,36)` |
| ---------------- | -----------------: | ---------------: | ------------------------------: |
| `rgb(13,42,102)` |              25.5% |          13.63:1 |                      **1.18:1** |
| `rgb(30,91,255)` |              21.9% |           5.26:1 |                          3.06:1 |

Nearly half the icon sits below 3:1 on a dark toolbar and its largest block is effectively invisible.
That is complaint 1 — "less visible in the extensions menu" — as a number. Found first by the Codex
pass from asset inspection, confirmed here from rendered pixels.

The Codex pass adds a finding this one missed: there are **three different mark constructions** in
the repo — the extension icon (folder/zipper), `pack-icon.svg` (document/download arrow), and the
header logo (a third compact mark plus 28 outlined word paths). The brand is not just detailed, it
is unsettled.

None of this is new information to the project. An Impeccable run on 2026-06-23 scored the logo
29/40 with two P1s — "wordmark too broad/heavy", "font too generic for a product logo" — and a P2
for the missing variant system. Fourteen months on, nothing was actioned.

## Three directions

Rendered at 128 / 32 / 16 px on both light and dark toolbars in `03-wireframes/index.html`.

**01 · The bound set** — square brackets closing around six marks. The brackets are the pack; the
six marks are the period grid. Four colours total, no detail thinner than 1.7px at 24-unit scale, so
it resolves as one dense object at 16px. It abandons the document/download metaphor entirely, which
is the largest break from the current identity and the reason to think twice. **Recommended.**

**02 · The filled year** — a 3×3 of periods filling in, last cell landing in ComplyEaze green.
Strongest at 32px and above, and it means something: progress through a year. Three tonal fills are
the first thing to muddy at 16px on a dark toolbar.

**03 · The stamped P** — a monogram with a rule beneath. Safest at every size, least ownable. Worth
keeping as the fallback, not the lead.

The Codex pass proposes two of its own — a Ledger P and a Target Archive — and recommends the Ledger
P for the same reason this pass recommends 01: at 16px a silhouette beats an illustration. Its
Ledger P and this pass's 03 are close cousins. **The two passes agree on the criterion and differ
only on how far to travel from the current metaphor.**

## Whichever mark wins

- Single-digit colour count at 16px.
- A field that holds on both a light and a dark toolbar. Prefer a lighter field or an outline
  variant over adding internal detail — adding detail is what caused this.
- One construction, five variants: toolbar, favicon, panel header, store listing, monochrome.

## The ComplyEaze lockup

Complaint 2 is a lockup rule, not a logo redesign. Both passes reached the same conclusion, which
contradicts the intuition in the complaint: **the fix is not to make ComplyEaze bigger.**

Pack is the product. ComplyEaze is the party the user is being asked to trust with an authenticated
portal session. Those need different weights in different places:

- **Toolbar and favicon** — mark only. No wordmark renders legibly at 16px.
- **Panel header** — mark + "Pack" at full weight; "ComplyEaze" as a separate right-aligned label
  around 10px in the muted tone. A publisher credit, not a second logo. It is legible precisely
  because it is not squeezed into the lockup.
- **Store listing, README, site** — the full lockup, with "by ComplyEaze" at no less than 40% of
  Pack's cap-height. The current asset is well under that, which is why the parent brand is
  technically present and practically absent.
- **Never** ComplyEaze/Axal purple. `.impeccable/design.json` in the parent repo reserves that hue to
  Axal-only locations, and using it here would create precisely the internal competition the
  complaint is worried about.

Codex proposes "by ComplyEaze" at 65–75% of Pack's text size. This pass proposes ≥40% of cap-height.
These measure different things and are not in conflict; pick one convention and write it into the
brand file rather than leaving both.

## `[ASK-FIRST]`

- Replacing the shipped `PACK_EXTENSION_ICONS` set touches `src/extension/manifest-policy.ts`.
- Store listing copy and imagery.
- Any public-copy change that strengthens a claim. The government-affiliation disclaimer stays
  wherever the mark goes: Pack is not affiliated with, endorsed by or operated by GSTN, CBIC or the
  Government of India.

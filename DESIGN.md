---
name: Pack
register: product
description: Local-first browser extension that saves a taxpayer's own filed GST returns to their own machine.
colors:
  surface: "#ffffff"
  surface-raised: "#fbfcfe"
  surface-muted: "#f7f9fb"
  canvas: "#f5f7fa"
  surface-inset: "#eef3f8"
  surface-accent-soft: "#e9f1f8"
  surface-sunken: "#e5ebf2"
  surface-accent: "#244d7c"
  surface-accent-strong: "#173b62"
  surface-inverse: "#111827"
  ink-primary: "#172033"
  ink-secondary: "#334155"
  ink-tertiary: "#43566b"
  ink-muted: "#526477"
  ink-link: "#244d7c"
  ink-inverse: "#ffffff"
  ink-inverse-muted: "#e5e7eb"
  border-subtle: "#d8e1ec"
  border-default: "#c8d3de"
  border-strong: "#9fb0c1"
  border-accent-soft: "#7894b2"
  border-accent: "#245b91"
  action: "#173a63"
  action-hover: "#0f2a49"
  success-fg: "#115d38"
  success-bg: "#e8f8ef"
  success-border: "#9cc7b1"
  success-solid: "#21815d"
  warning-fg: "#75420b"
  warning-bg: "#fff7e8"
  warning-border: "#ddc58b"
  danger-fg: "#7b241c"
  danger-bg: "#fff0ee"
  danger-border: "#e5b3ac"
typography:
  title:
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
    usage: "The one question a surface is asking. At most one per view."
  body:
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    usage: "Descriptions, explanations, review copy."
  control:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.3
    usage: "Buttons, chips, cell labels, table cells."
  label:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.25
    usage: "Compact labels, metadata and dense catalogue rows. This is the hard type-size floor."
spacing:
  scale: "4 / 8 / 12 / 16 / 24"
  cell: "20px"
  row: "32px"
---

# Design System: Pack

This file is the design contract for Pack's extension surfaces. It is the human-readable half;
`src/styles/global.css` holds the machine-readable half, and the two must agree. See
`docs/DESIGN_TOKENS.md` for how colour is defined and why.

## Overview

Pack is a compliance utility, not an application. The user is an Indian CA or compliance operator
with an authenticated portal session open, working through a month or a financial year of filings,
who cannot risk a wrong-taxpayer or wrong-period download. Everything here serves one goal: they
should be able to see what Pack is about to do, what it did, and what evidence it has, without
reading prose.

**Register:** product. Pack has no marketing surface inside the extension. The store listing and
`pack.complyeaze.com` are a separate brand register and are not governed by this file.

## Anti-references

Do not make Pack feel like a marketing landing page, a dashboard of decorative cards, a flashy SaaS
control panel, or a generic AI-generated settings screen. No hero treatment, no decorative
gradients, no glassmorphism, no vague success copy, no hidden failure states, no emoji, and no UI
that buries the actual download target.

## Colour

Colour is defined once, in the `:root` block of `src/styles/global.css`. A colour literal anywhere
else in the stylesheets is a defect — see `docs/DESIGN_TOKENS.md` for the eight-shades-of-one-grey
incident that produced this rule.

- **Structure through tone, not elevation.** `canvas` is the ground, `surface` sits on it defined by
  a 1px border, `surface-inset` and `surface-sunken` are contained regions. No shadows, no blurs.
- **One action colour.** `action` is the primary button and the selected state. Everything else is
  neutral or semantic.
- **Semantic colour is a triad** — foreground, background and border for one condition. Use all
  three; a status background without its border reads as an accident.
- **Never colour alone.** Every status carries a glyph or a word as well as a hue.
- **Never ComplyEaze/Axal purple.** That hue is reserved to Axal brand locations by the parent
  design system, and using it here creates internal brand competition.

Every ink/surface pair **that the rendered UI actually produces** passes WCAG AA: 167 rules and 320
rendered colour pairs, zero failures, measured once against a preview build.

This is deliberately not a claim about every combination of tokens. Inverse ink exists to sit on
inverse surfaces, so the Cartesian product of the two token families contains pairs that are never
rendered and would fail badly if they were — 27 of 63, including `--pack-ink-primary` on
`--pack-surface-inverse` at 1.09:1. Pairing a token with a surface it was not made for is a bug the
palette cannot prevent.

Nothing enforces either statement yet: there is no test that recomputes contrast or rejects a colour
literal outside `:root`. Tracked in #171. `PRODUCT.md` sets WCAG 2.1 AA as the target.

## Typography

Four sizes, three weights. Nothing else.

- **Bold is not a hierarchy tool here.** Hierarchy comes from size and ink level — `ink-primary`,
  `ink-secondary`, `ink-muted`. Pack previously had 36 weight declarations and not one regular
  weight, which is why nothing on the surface could be emphasised.
- **Monospace for every number**, target identifier, status pill, count and duration, with
  `font-variant-numeric: tabular-nums`. Numeric columns are right-aligned; text columns are
  left-aligned.
- **Nothing below 12px.** Use 12px only for compact labels, metadata and dense catalogue rows;
  sentence case is valid when it makes a target or limit easier to scan.
- **Ship the font or do not name it.** A stack whose first entry is not bundled renders differently
  on a developer's machine than on a user's.

## Layout

- **Panel: correct at 320px, comfortable up to 420px.** Extra width may improve wrapping but must
  not reveal content that was clipped at 320px. **Popup: 420 × 560**, hard-clamped by Chromium at
  800 × 600 and closing on outside focus. Design for the panel; the popup gets status and two
  buttons.
- **Bands, not cards.** A surface is a vertical stack of full-width bands separated by a 1px rule.
  Do not wrap every section in a rounded card.
- **Density is the point.** Row height 32px, matrix cell 20px. Spacing comes from the 4/8/12/16/24
  scale; there is no 3px, 5px, 7px or 9px.
- Wide content scrolls inside its own container. The panel body never scrolls sideways.

## Shape

Radii are small and consistent: 2px on cells and pills, 4–6px on buttons and panels. Nothing is
pill-shaped except a format chip.

> **Open proposal, not yet adopted.** An external pass argued for 0px everywhere, on the grounds
> that sharp corners reinforce the ledger metaphor and let cells pack without visual gaps. It is a
> real argument and it suits the matrix. It has not been adopted because it has not been tested
> against the review card and the primary action, where some softness currently separates an
> interactive control from a data cell. Decide it deliberately.

## Components

- **Matrix cell** — 20px, 1px border, 2px radius. Five states: unselected, selected, saved,
  needs-review, unavailable. Unavailable is hatched, never merely greyed, and **must state its
  reason** in visible text. A disabled control must programmatically reference that reason; hover
  alone is not an accessible explanation.
- **Ledger row** — 32px, bottom border only, header sticky on `surface-muted`. Columns: target,
  format, status, evidence.
- **Status pill** — bordered rectangle, 2px radius, monospace, semantic triad. Never a bare colour.
- **Review card** — one heading, one sentence, at most three stacked full-width buttons. The first
  is primary; the rest are ghost.
- **Primary action** — one per surface, `action` background, `ink-inverse` text.
- **Cost line** — monospace, two lines, states what the run will actually cost the user in files,
  archives and save prompts.
- **Guided scope** — four catalogue-derived steps: return, financial year, the periodicity-derived
  axis, then artifact. Keep one exact return/FY/period/artifact scope visible throughout, expose no
  more than four controls including the catalogue disclosure, and place the target review before
  the final action.
- **Return catalogue** — one canonical row owns the label, support status, periodicity and artifact
  availability. Runnable options are derived from supported rows. Declared-but-unsupported rows
  are explanatory text, never disabled or misleading controls.

## Return periodicity

Periodicity is structural data, not a label inferred from the return name. The model contains four
complete axis shapes: monthly, quarterly, annual and non-period-based. The three currently supported
returns are monthly, but the panel must not encode that temporary fact as a permanent month grid or
a return-name switch. A future support-status change should activate the catalogue row's existing
periodicity and artifact data without adding a second hand-maintained UI list.

The chosen direction is the guided scope in
`design-lab/10-catalogue-overhaul/04-judgement.md`. It was the only explored direction that kept the
control budget at four while deriving every axis from periodicity. The outcome-recipe direction was
faster but grew to eight controls after selection. The compact-register direction was fastest, but
its runnable scope was monthly-specific and had five actual controls. Those alternatives remain
useful references, not parallel product contracts.

## Copy

- Say what happened, then what to do. "Chrome saved a file, but Pack could not match it to July."
- Never claim completion Pack cannot evidence. A skipped target is settled, not complete.
- **Never display a taxpayer identifier, a filename, a portal URL or a local path.** Evidence is a
  safe class — "download confirmed" — not a location. This overrides any external guidance
  suggesting monospace treatment for PAN or GSTIN: those must not be on screen at all.
- Keep the government-affiliation disclaimer wherever the mark appears. Pack is not affiliated with,
  endorsed by or operated by GSTN, CBIC or the Government of India.

## Motion

State changes only, under 160ms, and `prefers-reduced-motion` honoured. No scroll choreography, no
parallax, no perpetual micro-motion, no staggered reveals. Nothing on this surface should move that
is not reporting a change in what Pack is doing.

## Provenance

The colour and type values here are Pack's own, chosen from Pack's own contrast measurements. The
role _names_ deliberately track the Sanchika vocabulary — canvas, surface, ink, border, status
triads — so that a future adoption is a rename rather than a redesign. Pack is Sanchika's third
consumer and its entry criteria are not met yet; nothing is imported. See `docs/DESIGN_TOKENS.md`.

A generated design system from an external tool was reviewed while writing this. Its structured
output carried a generic Material palette that contradicted its own prose, sized the layout for a
1440px desktop rather than a 400px panel, and recommended monospace treatment for PAN and GSTIN —
identifiers Pack must never render. Its useful contributions were tonal layering over shadows,
banning bold as a hierarchy device, monospace for all data, and the sharp-corner argument recorded
above. External design tools are references here, never sources of truth.

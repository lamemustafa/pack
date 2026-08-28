# Design tokens

Colour is defined once, in the `:root` block of `src/styles/global.css`, and nowhere else. Three of
the four stylesheets contain no colour literal at all.

## The rule

**Style against a role, never against a shade.** `var(--pack-ink-muted)` says what the text is for;
`#526477` says only what it looks like today. If you need a colour that no role describes, add a
role — do not write a literal.

A literal in `popup.css`, `popup-controls.css` or `popup-target-summary.css` is a defect, and it is
the defect that produced the accessibility failures described below.

## Why this exists

Before this collapse the four stylesheets held **102 distinct colour literals across 157
occurrences**, against 19 tokens referenced 31 times. `popup-controls.css` — which styles every
radio group, option card and select in the builder — referenced the token system exactly once.

Nobody chose 102 colours. They accumulated. Clustered perceptually, the 43 distinct text colours
were really **14 intents**, and the single largest cluster was **eight near-identical muted greys**:

    #5e6b80  #526477  #556070  #607287  #5c6c7d  #56677a  #5c6d80  #64768a

One colour, written eight times, drifting each time. **Five of those eight fail WCAG AA** against at
least one background Pack actually paints:

| Shade     | Worst contrast on a Pack surface |                                                     |
| --------- | -------------------------------: | --------------------------------------------------- |
| `#64768a` |                           3.89:1 | fails                                               |
| `#607287` |                           4.11:1 | fails                                               |
| `#5c6d80` |                           4.42:1 | fails                                               |
| `#5c6c7d` |                           4.49:1 | fails                                               |
| `#5e6b80` |                           4.50:1 | fails (on the line, and the most-used of the eight) |
| `#56677a` |                           4.84:1 | ok                                                  |
| `#526477` |                       **5.07:1** | ok — now `--pack-ink-muted`                         |
| `#556070` |                           5.31:1 | ok                                                  |

An external detector found _one_ of those five, because a spot check can only see the instance it
happens to sample. Deduplication found all five, because once the eight copies become one role there
is only one value left to check. `PRODUCT.md` names WCAG 2.1 AA as the target for these surfaces.

The same pattern held elsewhere: 28 background literals were 6 intents, and 23 border literals were
10 — including ten shades of one subtle border.

## Result

|                                                       | Before |                After |
| ----------------------------------------------------- | -----: | -------------------: |
| Colour literals outside `:root`                       |    157 |                **0** |
| Distinct literals                                     |    102 | 34 (all definitions) |
| `var(--pack-*)` references                            |     31 |                  175 |
| Distinct colours rendered across the 9 preview states |     36 |               **20** |
| WCAG AA failures across 165 rendered text nodes       |      5 |                **0** |

Verified by rendering all nine states in `dev/popup-preview.html` and comparing computed styles
before and after: same 397 nodes, no element lost its colour, and every text node's contrast against
its effective background was recomputed.

## The roles

Grouped as they are defined. Surfaces run lightest ground to darkest fill. Each ink passes AA
against the surfaces it is actually paired with — not against every surface: inverse ink belongs on
inverse surfaces, and 27 of the 63 possible combinations fail. See `DESIGN.md` for the measurement
and `tests/styles/design-token-literals.test.ts` for the literal detector.

- **Surface** — `surface`, `surface-raised`, `surface-muted`, `canvas`, `surface-inset`,
  `surface-accent-soft`, `surface-sunken`, `surface-accent`, `surface-accent-strong`,
  `surface-inverse`
- **Ink** — `ink-primary`, `ink-secondary`, `ink-tertiary`, `ink-muted`, `ink-link`, `ink-inverse`,
  `ink-inverse-muted`
- **Border** — `border-subtle`, `border-default`, `border-strong`, `border-accent-soft`,
  `border-accent`
- **Action** — `action`, `action-hover`
- **Status** — `success-fg` / `-bg` / `-border` / `-solid`, `warning-fg` / `-bg` / `-border`,
  `danger-fg` / `-bg` / `-border`

Status triads are foreground, background and border for one condition. Use all three together; a
status background without its border reads as an accident.

## Relationship to Sanchika

Pack does not consume Sanchika today, and this token layer is not an attempt to.

`sanchika/docs/adoption-pack.md` states that Pack is Sanchika's **third** consumer, and its entry
criteria require ComplyEaze completion evidence and Axal completion evidence to both exist first.
`sanchika/docs/adoption-evidence.md` is still a blank template, so neither exists yet. Pack's own PR
gate also forbids importing `../sanchika` or `sanchika/packages/*/src` by parent-relative path, and
any package dependency is ask-first under `AGENTS.md`.

So the role **names and structure** deliberately track Sanchika's vocabulary — canvas, surface,
surface-raised, surface-inset, ink-primary, ink-secondary, ink-muted, ink-inverse, border-subtle,
border-default, border-strong, and foreground/background/border status triads — while the **values
stay Pack's own** and nothing is imported.

The point is the migration cost. When Pack's turn arrives, adoption is a prefix rename and a value
swap against a vocabulary that already lines up, rather than a redesign. Inventing a fourth,
Pack-shaped vocabulary now would have guaranteed the redesign.

Two known differences to resolve at adoption time, recorded here so they are not rediscovered:

- Sanchika's source of truth is **OKLCH**; Pack's values are hex. Converting is mechanical.
- Sanchika ships **one canonical light theme** and no dark theme. Pack's popup is already
  `color-scheme: light` only, so this is currently compatible and will stop being compatible the
  moment Pack wants a dark surface.

## Changing a colour

1. Change the value in `:root` in `src/styles/global.css`.
2. Re-run the nine-state check in `dev/popup-preview.html` and confirm contrast still passes.
3. Do not add a literal at the call site to "just fix this one" — that is how the eight greys
   happened.

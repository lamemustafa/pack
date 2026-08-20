# Tooling log — Claude pass

Everything here ran outside the worktree or under ignored paths. `git status --porcelain` was clean
of tool output before commit.

## Impeccable

`npx impeccable@latest`. No API key needed for `detect`; it is deterministic and LLM-free.

| Run                                                      | Exit | Findings |
| -------------------------------------------------------- | ---: | -------: |
| `detect src/styles src/entrypoints/popup` (static)       |    0 |    **0** |
| `detect --json <four explicit CSS/TSX files>` (static)   |    0 |    **0** |
| `detect --viewport 420x600 <served popup URL>` (browser) |    2 |    **4** |

Browser-mode findings:

| Finding                                                                     | Verdict                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `low-contrast` 4.49:1, needs 4.5:1 — `#64768a` on `#f8fbfe`                 | **Accepted.** `src/styles/popup.css:423`. Reproduced independently two other ways.                                                                                                                                                                       |
| `flat-type-hierarchy` — 11–18px at ratio 1.6:1, "no clear visual hierarchy" | **Accepted.** Matches the independent count of 7 rendered sizes.                                                                                                                                                                                         |
| `overused-font` — Inter at 100% of text                                     | **Accepted with a correction.** The real defect is not that Inter is common; it is that Inter is _named and not shipped_, so this machine renders it and a user's machine may not. The detector cannot see that, because it measures what rendered here. |
| `cramped-padding` — 0px vertical on 14px text                               | **Accepted as low severity.** Real, but `PRODUCT.md` asks for operational density; the fix is a spacing scale, not more padding everywhere.                                                                                                              |

**The static/browser split is the useful result.** Zero findings from static analysis, four from
rendering. Impeccable's 59 rules hunt AI-slop signatures — gradients, nested cards, bounce easing,
dark glows — and Pack has none of them. Pack is not slop; it is _undesigned_. A slop detector is
close to blind to that, and reading its `[]` as a pass would be the wrong conclusion. The parent
ComplyEaze repo hit the same empty static result in June 2026.

**Version skew, and it matters.** The Codex pass ran a globally-installed copy at
`~/.agents/skills/impeccable` (0 findings) _and_ `pnpm dlx impeccable` (3 findings, a different set,
one of which it correctly rejected as a static mis-pairing of colours across preview states). This
pass ran `npx impeccable@latest` (0 static, 4 browser). Three invocations, three different counts.
**No Impeccable count in this lane is comparable to another unless the version is pinned.** Pin it
before anyone treats a number as a gate.

## Taste Skill

`github.com/nxpatterns/claude-taste-skill`, `skills/taste-skill/SKILL.md`, read directly rather than
installed — the skill is an instruction file for an agent, not a runnable analyser, so "running" it
means applying its rules.

**Rejected wholesale for this surface.** It is built for marketing and portfolio work and its
mandates are the literal inverse of `PRODUCT.md`'s anti-references: Tailwind for 90% of styling,
Framer Motion, GSAP ScrollTrigger, ThreeJS/WebGL, magnetic cursor-following buttons, parallax tilt
cards, macOS-dock magnification, `rounded-[2.5rem]` on all major containers, diffusion shadows,
staggered waterfall reveals, infinite carousels. `PRODUCT.md` says in as many words: do not make the
extension feel like a marketing landing page, a dashboard with decorative cards, or a flashy SaaS
control panel; avoid oversized hero treatment and decorative gradients. Applying this skill to Pack
would produce exactly the product `PRODUCT.md` forbids.

Pack is also not a Tailwind or shadcn codebase, so ~90% of the skill's concrete guidance has no
target.

**Four rules extracted anyway**, tested against the code:

| Rule                                                          | Pack today                                                                                 | Verdict                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| "Max 1 accent colour, saturation < 80%"                       | 102 distinct hex literals, no single accent                                                | **Fails.** Sharpens the identity finding.                                                          |
| Baseline spacing scale of 8 / 6 / 4                           | 14 distinct gap/padding values, including 3, 5, 7 and 9px used beside 4, 6, 8 and 10px     | **Fails.** No scale exists.                                                                        |
| "No pure black — never `#000000`"                             | Ink is `#101923`                                                                           | **Passes.**                                                                                        |
| "Control hierarchy with weight and colour, not massive scale" | 36 weight declarations, none below 650 — no contrast available to control hierarchy _with_ | **Fails**, in an unusual direction: the problem is too much weight everywhere, not too much scale. |
| "No fake numbers — avoid 99.99%, 50%"                         | n/a                                                                                        | Adopted for the wireframes: counts are 27 files / 16 saved / 1 needs review, not round numbers.    |

## 21st.dev

**Rejected without running.** It is a React/Tailwind/shadcn component catalogue and generator. Pack
is neither Tailwind nor shadcn, and `AGENTS.md` permits named libraries "strictly as references,
never wholesale-imported". Its value here would be inspiration at the cost of a dependency
conversation, and the surface in question is a 420px extension popup with roughly nine components.
Running it for completeness would have produced a log entry and no finding.

## Browser

Chrome via the in-app browser pane, viewport 420 × 600 and 1180 × 900. Used for: mounting the built
popup with a stubbed `chrome` global; measuring frame vs content height, focusable-control count,
rendered font sizes and weights, and `document.fonts`; rasterising `icon-16.png`, `icon-32.png` and
`pack-extension-icon.svg` to a canvas for per-pixel colour counts and WCAG contrast against light
and dark toolbar grounds.

This is the capability the Codex pass lacked — its DevTools MCP evaluation was cancelled and
Playwright aborted on both Chrome and Brave.

## Footprint

Nothing installed into the worktree. `npx` and `pnpm dlx` caches live in the user npm cache; the
popup harness and icon probe were written into `.output/` (gitignored, rebuildable) and deleted
after use. `design-lab/_tools/` from the Codex pass remains ignored and untracked.

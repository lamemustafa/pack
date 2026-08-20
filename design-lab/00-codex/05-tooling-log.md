# Tooling Log

## Repo And Build

| Tool                             | Result                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status --short --branch`    | Branch `tapish-codex/ux-redesign...origin/master [ahead 1]`; no working-tree dirt at intake.                                                            |
| `pnpm install --frozen-lockfile` | Passed. Output said the lockfile was already up to date and completed in 238 ms with pnpm 11.1.2.                                                       |
| `pnpm exec wxt build`            | Passed. WXT 0.20.27 / Vite 8.1.2 built `.output/chrome-mv3` in 1.150 s; total size 900.98 kB.                                                           |
| `graphify update .`              | Ran because no `graphify-out/graph.json` existed. It produced 1979 nodes, 4103 edges, 149 communities. `graphify-out/` is gitignored.                   |
| `graphify query ...`             | Used to orient popup state/data-flow files before text search.                                                                                          |
| `pnpm exec prettier --check ...` | Passed after formatting Markdown/HTML. SVG files required `--parser html` because this repo's Prettier setup did not infer an SVG parser automatically. |

## Impeccable

The repo-local `.agents/skills/impeccable/scripts/context.mjs` path was absent, so I used the
installed user skill at `~/.agents/skills/impeccable`. I read the Impeccable product register and
the critique/audit references, then ran the deterministic detectors.

| Command                                                                                                              | Exit | Raw Count | Result          |
| -------------------------------------------------------------------------------------------------------------------- | ---: | --------: | --------------- |
| `node ~/.agents/skills/impeccable/scripts/detect.mjs --json src/entrypoints/popup src/styles dev/popup-preview.html` |    0 |         0 | No findings.    |
| `pnpm dlx impeccable detect --json src/entrypoints/popup src/styles dev/popup-preview.html`                          |    2 |         3 | Three warnings. |

Warnings from `pnpm dlx impeccable detect`:

| Warning                                              | Accepted?                | Disposition                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Low contrast, snippet pairing `#172033` on `#0f2a49` | Rejected                 | Static scan paired colors across preview toolbar states. Actual sampled toolbar pairs are 16.27:1. Product CSS should still avoid ambiguous state rules.           |
| Overused font: Inter                                 | Accepted as low severity | Product UI can use system/Inter, but Pack needs identity from mark, layout, and evidence vocabulary rather than a generic font alone.                              |
| Glowing shadow accents                               | Partly accepted          | The active popup uses border plus a soft shadow vocabulary in some legacy classes. Not a release blocker, but the direction should use flatter operational panels. |

## Browser And Measurement Tools

| Tool                                    | Result                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Local static server on `127.0.0.1:8765` | Served repo root for `dev/popup-preview.html`.                                                                         |
| Local static server on `127.0.0.1:8766` | Served `.output/chrome-mv3` because built popup chunks use root-relative paths.                                        |
| Chrome DevTools MCP                     | `list_pages` saw an `about:blank` page, but `evaluate_script` calls were cancelled by the tool.                        |
| Playwright-core                         | Installed under ignored `design-lab/_tools/playwright` with cache redirected to ignored `design-lab/_tools/npm-cache`. |
| System Chrome via Playwright            | Failed before page load: browser closed/aborted.                                                                       |
| System Brave via Playwright             | Failed before page load: browser closed/aborted.                                                                       |
| ImageMagick                             | Used for icon asset aggregation.                                                                                       |

Browser-rendered screenshot evidence is therefore incomplete. I did not treat the failed browser
tools as product evidence. Measurements in `01-findings.md` are derived from source CSS, preview
HTML, package build output, and raster/icon asset inspection.

## Tool Footprint

Installed/generated tool files are under ignored paths:

- `design-lab/_tools/`
- `graphify-out/`
- `.output/`

`git status --porcelain` was checked after tool installation and before writing deliverables; no
tool footprint appeared as tracked or untracked output.

# design-lab — Pack UI/UX redesign lane

Exploration only. Nothing here ships, nothing here is imported by `src/`, and nothing here makes a
claim about Pack that `docs/PUBLICATION_READINESS.md` does not already permit.

## Layout

| Path         | Owner   | Contents                                                                              |
| ------------ | ------- | ------------------------------------------------------------------------------------- |
| `00-codex/`  | Codex   | independent first pass — findings, direction, wireframes, brand, tooling log, handoff |
| `01-claude/` | Claude  | second pass — its own take, then the diff against Codex's                             |
| `_tools/`    | neither | external design tooling. Untracked. Never committed.                                  |

## Protocol

The two passes are **sequential, not concurrent**. One agent occupies this worktree at a time.

This is not ceremony. Two agents in one checkout produced ten phantom test failures in this repo
once already, and the decisions log records a second case where an uncommitted file from one agent
was reported as a repository defect by the lane measuring it. Whoever holds the worktree commits
before handing it over.

1. **Codex** works from `00-codex/BRIEF.md`, blind to the other take, and commits.
2. **Claude** adds `01-claude/`, then writes `01-claude/09-diff.md` — where the two agree, where
   they disagree, and which reading the evidence actually supports.
3. Only then does anything become a PR, and the PR body is built from
   `.github/PULL_REQUEST_TEMPLATE.md`, not written from scratch.

## Tooling

External design tooling is approved for this lane and forbidden in a commit. Footprints are listed
in the worktree's `info/exclude`. Run `git status --porcelain` before every commit and confirm
nothing tool-related is staged.

A detector finding is a hypothesis. `PRODUCT.md` asks for operational density and explicitly
rejects decorative cards, hero treatment and marketing-page feel — where a general-purpose design
tool argues against that, `PRODUCT.md` wins and the disagreement gets recorded rather than
silently resolved.

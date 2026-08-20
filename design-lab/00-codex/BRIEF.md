# Codex brief — Pack UI/UX, independent take

**Lane:** `tapish-codex/ux-redesign`
**Worktree:** this checkout (yours alone until you hand off)
**Your output directory:** `design-lab/00-codex/`
**Do not write anywhere else** except the files this brief names.

---

## 0. Read this first: you are the first pass, deliberately

A Claude thread has already produced its own teardown of this surface. **It is not in this
worktree and you must not ask for it.** The point of running you separately is to get an
independent reading, and an independent reading is worthless if it starts from someone else's
conclusions. Reach your own findings, in your own order, with your own evidence. The two takes get
diffed _after_ you commit — where you disagree is the most useful output of the whole exercise.

If you find yourself reasoning "the obvious answer is X", write down what would have to be true for
X to be wrong, and check that first. This repo's own decisions log records that three specs in one
session were written from a plausible mechanism and each was falsified by the next probe.

---

## 1. What Pack is, in one paragraph

A WXT/Vite MV3 browser extension that saves a taxpayer's own filed GST returns to their own
machine. No account, no backend, no telemetry. Public, open-source, Apache-2.0, handling sensitive
compliance data. The user is an Indian CA or compliance operator with an already-authenticated GST
Portal session, usually working through a month or a full financial year of filings, who cannot
risk a wrong-taxpayer or wrong-period download.

Read `AGENTS.md` at the repo root before you touch anything. It is authoritative and it overrides
this brief wherever the two disagree.

---

## 2. The problem, in the owner's own words

Fifteen complaints, unedited. Treat them as symptoms reported by a user, not as a work order —
several are probably the same defect, at least one is probably wrong, and the interesting output is
your own sorting of them.

1. The logo doesn't look good; the favicon is not memorable and is small/less visible in the
   extensions menu.
2. Brand ComplyEaze is lost, but incorporating it should reinforce Pack's identity — the two
   should not compete.
3. Too many clicks and configurations before the desired run starts.
4. No consistency across the current filing types.
5. Can't run something like a GSTR-3B whole-year reconciliation independently of the
   JSON / full-year / all-formats full-year run.
6. Can't trigger multiple filing types.
7. Multiple formats or multiple months can't be easily selected.
8. Errors and retries are complex to handle; when stuck, the user can't easily refresh the
   extension or clear state.
9. Only GST is supported; income tax, MCA and others should be possible.
10. Only three GST filings are supported; more are wanted.
11. Not result-driven — "give me the last 3 years of ITRs" is not expressible.
12. Not simple/clean enough for lightweight users, not configurable enough for power users.
13. Too many clicks; size and layout problems.
14. Text rendering is bad.
15. Not appealing; no clear, distinct, unique identity.

The owner has since clarified two things:

- **Pack may grow beyond downloading into more advanced capabilities, provided every added
  capability is stated plainly and transparently.** That is the point of it being open source.
  Advanced ≠ hidden. Anything Pack computes must be traceable to what the portal actually gave it.
- **You are free to download and install external design tooling** (see §6). Nothing you install
  may end up in a commit.

---

## 3. Non-negotiables — a proposal that violates one of these is rejected, not debated

From `AGENTS.md`. These are not style preferences; several were written after a live incident.

- **Never** collect, store, log or transmit GST credentials, OTPs, CAPTCHA responses, cookies,
  tokens or session material. Never upload GST documents, GSTIN, PAN, ARNs, taxpayer names,
  filenames, portal HTML or tax metadata anywhere.
- **Never** put a portal URL, cookie, header, cURL command, GSTIN, PAN, ARN, taxpayer name or local
  path into a file, an issue, a PR or a commit message. That includes screenshots — if you capture
  a live portal page, it does not go in this repo.
- **Never** construct a portal URL to navigate. Click the portal's own control. Two constructed
  navigations were WAF-rejected and one ended a live session.
- **Never** mark a target complete on a click alone. Completion requires correlated
  `chrome.downloads` evidence of a completed, non-empty portal file. Unknown-size, zero-byte,
  interrupted, ambiguous and unrelated downloads route to explicit review, never to blind retry.
  **Any redesign that makes batch selection easier must keep this guard per target.** If your design
  makes it tempting to weaken target binding so a batch can pass, say so out loud instead of
  weakening it.
- **Never** add analytics, telemetry, remote selector config, remote executable code,
  `externally_connectable`, or broad host permissions.
- **Always** keep the government-affiliation disclaimer in public copy. Pack is not affiliated with,
  endorsed by or operated by GSTN, CBIC or the Government of India.
- **Always** keep shared contracts in `src/core` portal-neutral and GST specifics in
  `src/connectors/gst`.

**Ask-first — propose, flag clearly, do not implement:**

- any change to `src/extension/manifest-policy.ts`, `wxt.config.ts`, permissions, host permissions
  or CSP. The reviewed set is `downloads`, `offscreen`, `scripting`, `storage`, plus exactly four
  GST hosts;
- any new runtime dependency;
- persisting a new field or widening what is persisted;
- weakening a target-binding or identity guard;
- public copy, README, store text or release notes that strengthen an existing claim.

Mark every ask-first item in your output with a literal `[ASK-FIRST]` tag so they can be extracted.

---

## 4. Get your own evidence. Do not infer from source alone.

This repo's recorded failure mode is a hand-maintained duplicate of a fact that already had a
canonical source — and the second-most common one is a spec written from a plausible mechanism.
Measure before you assert.

```sh
pnpm install --frozen-lockfile
pnpm exec wxt build                # → .output/chrome-mv3
```

Two ways to see the UI without a live portal session:

- `dev/popup-preview.html` — an existing static harness that renders the popup shell across nine
  states (ready, ready-single, blocked, downloading, partial, complete, unsupported,
  session-expired, unexpected-error). It links the real stylesheets. Serve the repo root and open
  it. **Start here** — it is the cheapest way to see every terminal state.
- The built popup at `.output/chrome-mv3/popup.html`, driven with a stubbed `chrome`/`browser`
  global so the React tree mounts. You have `chrome-devtools-mcp` and the bundled Chrome plugin —
  use them to render, measure and screenshot.

Things worth measuring rather than assuming: the popup's rendered width and height against its
content height; the number of interactive controls needed to express one file; the actual set of
font sizes and weights that render; contrast ratios; tap-target sizes; what the toolbar icon looks
like at 16px on both a light and a dark Chrome toolbar.

Do not run a live authenticated portal session for this task. It is not needed for a UI critique
and it puts taxpayer data in scope for no benefit.

---

## 5. Surfaces to read

| Path                                                                 | Why                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/entrypoints/popup/**`                                           | the whole UI, 12 files                                                     |
| `src/styles/{global,popup,popup-controls,popup-target-summary}.css`  | all the visual decisions                                                   |
| `src/entrypoints/options/main.tsx`                                   | the second surface; note what is reachable from where                      |
| `src/connectors/gst/filed-returns-contracts.ts`                      | the data model the UI edits                                                |
| `src/connectors/gst/filed-returns-{scope,artifacts,return-types}.ts` | what is expressible today                                                  |
| `src/extension/manifest-policy.ts`                                   | the reviewed permission and host set                                       |
| `public/brand/**`, `public/icons/**`                                 | every logo and icon variant that exists                                    |
| `PRODUCT.md`                                                         | the stated register, principles and anti-references                        |
| `docs/PORTAL_INTEGRATION_FINDINGS.md`                                | captured live portal facts — read before theorising about portal behaviour |
| `docs/PUBLICATION_READINESS.md`                                      | what may and may not be claimed                                            |
| `.github/PULL_REQUEST_TEMPLATE.md`                                   | the gated PR body sections                                                 |

Also read the private knowledge hub if it is checked out nearby — it is the `brain` repo, cloned
as a sibling of this one. Relevant entries:

- `30-market/competitors/gst-return-downloader-extensions.md`
- `10-domains/12-gst/gst-portal-automation-invariants.md`
- `10-domains/14-browser-extensions/mv3-download-and-automation-constraints.md`
- `40-decisions/duplicated-contract-failure-mode.md`

**Nothing from `brain` may be quoted, pasted or paraphrased into this public repo.** Use it to
inform your judgement, then state your conclusion in your own words from public evidence. If a
finding is only defensible by citing the hub, put it in your handoff note, not in a committed file.

---

## 6. External design tooling — you are cleared to install it, not to commit it

The owner has explicitly approved downloading external design tooling for this lane. This is a
**standing exception for this worktree only**; `AGENTS.md`'s prohibition on adding third-party
hooks, skills, MCP servers or agent config to the repo still holds for anything that would land in
a commit.

Candidates, in rough order of expected value:

- **Impeccable** — `npx impeccable install` then `/impeccable audit`, `/impeccable critique`.
  59 deterministic detector rules for AI-generated frontend design.
  `https://github.com/pbakaus/impeccable`
- **Taste Skill** — `npx -y skills add leonxlnx/taste-skill`. Layout, typography, motion, spacing.
  `https://github.com/nxpatterns/claude-taste-skill`
- `skills.sh`, `21st.dev`, and anything else you find that is actually relevant to a dense
  operational extension surface. Judge them; do not run all of them for completeness.

Rules:

1. Install into `design-lab/_tools/` where the tool allows a target directory, otherwise into the
   worktree root and delete before you commit.
2. `design-lab/_tools/` and the usual tool footprints (`.impeccable/`, `.taste/`, `skills/`,
   `AGENTS.impeccable.md`, …) are already in this worktree's `info/exclude`. Verify with
   `git status --porcelain` that nothing tool-related is staged **before every commit**.
3. Keep the tools' **findings**, discard the tools. A committed critique markdown is the artifact.
4. A detector finding is a hypothesis, not a verdict. Several will be false positives against a
   deliberately dense compliance surface — `PRODUCT.md` explicitly wants operational density and
   explicitly rejects decorative cards and hero treatment. Where a tool tells you to make Pack
   friendlier and `PRODUCT.md` says don't, `PRODUCT.md` wins and you record the disagreement.

---

## 7. What to produce

Write these into `design-lab/00-codex/`:

**`01-findings.md`** — what you measured, with numbers, and what it means. Sort the fifteen
complaints into root causes; say plainly which of them you think are wrong or are really the same
issue. Every claim about current behaviour must be traceable to a file you read or a measurement
you took.

**`02-direction.md`** — your proposed information architecture. Specifically:

- how a user expresses a _result_ rather than a configuration (complaint 11);
- how multiple periods, multiple return types and multiple formats are selected in one gesture
  (5, 6, 7) **without** loosening per-target binding;
- how the surface stays legible for a light user and dense enough for a power user (12);
- how a paused or failed target asks the user one answerable question (8);
- where "reset everything" lives (8);
- how a second portal — income tax, MCA — slots in without a rewrite (9), and what it costs
  `[ASK-FIRST]`;
- what "more advanced capabilities, stated transparently" should mean concretely for a tool whose
  whole differentiator is auditability.

**`03-wireframes/`** — self-contained static HTML, no build step, no external assets. One file per
screen or one file with a state switcher; your call. They must render by opening the file. If you
propose a surface other than the action popup, say which and why, and tag the permission
`[ASK-FIRST]`.

**`04-brand.md`** + `03-wireframes/marks/` — the logo and favicon problem (1, 2, 15). At minimum:
your reading of why the current mark fails, at least two alternative directions as SVG, each
rendered at 128 / 32 / 16 px, and a lockup rule for how ComplyEaze appears alongside Pack without
the two competing. Note that `.impeccable/design.json` in the _parent_ ComplyEaze repo reserves the
Axal brand purple to Axal-only locations.

**`05-tooling-log.md`** — what you installed, what it reported, what you accepted, what you
rejected and why. Include the raw counts. Confirm the tools left no tracked footprint.

**`06-handoff.md`** — for the Claude thread that picks this up. What you are confident in, what you
are unsure about, what you deliberately did not do, and the two or three questions where you most
expect the other take to disagree. Anything that depends on the private hub goes here.

---

## 8. Git discipline

- Branch `tapish-codex/ux-redesign` already exists and this worktree is on it. **Do not switch
  branches, do not rebase, do not touch `master`.**
- Conventional Commits titles, CI-enforced. Commit in logical lanes — findings, wireframes, brand,
  tooling log separately. `docs(design):` or `chore(design):` are the right types here; nothing in
  this lane is `feat` because nothing ships to users yet.
- `git status --porcelain` must show no tool footprint before each commit.
- **Do not open a PR and do not push.** This lane is handed to a second thread first. If you want it
  pushed, say so in `06-handoff.md`.
- Do not run `pnpm review:gate` — there is no PR yet and it will fail for the wrong reason.
- If you change any runtime source (you probably should not for this task), the full gate applies:
  `pnpm exec vitest run`, `pnpm exec tsc --noEmit`, `pnpm exec eslint . --max-warnings 0`,
  `pnpm exec prettier --check .`, and quote the last three lines of the Vitest output verbatim.
  Documentation and wireframes under `design-lab/` need `prettier --check` only.

## 9. When you are done

Print, in the final message: the commit SHAs you created, the files you added, every `[ASK-FIRST]`
item as a flat list, and the single change you would make first if you were only allowed one.

# src/ — Architecture Notes

Native content (no sibling `AGENTS.md` in `src/` to import). Root `AGENTS.md`
and root `CLAUDE.md` still apply; this file adds concrete orientation for
working inside `src/`.

## Layout

```
src/
  entrypoints/   background.ts, content.ts, options/, popup/  (WXT entrypoints)
  core/          portal-neutral contracts, manifest, redaction, naming, csv
  connectors/gst/ everything GST-portal-specific (DOM, hosts, flow, download)
  background/    service-worker-side logic used by entrypoints/background.ts
  extension/     manifest-policy.ts (permissions/CSP source of truth), version.ts
  styles/        global.css
```

## core vs connectors/gst boundary

`src/core` must stay portal-neutral: contracts (`contracts.ts`), manifest
building (`manifest.ts`), redaction (`redaction.ts`), naming, CSV, filed-returns
_shape_ types (`filed-returns-artifacts.ts`, `filed-returns-return-types.ts`,
`filed-returns-scope.ts`). Nothing in `core` may import from
`connectors/gst` or know about GST DOM structure, GST hosts, or GST-specific
copy. This is what lets a second connector be added later without touching
`core`.

`src/connectors/gst` holds everything that only makes sense for the GST
portal: host allowlisting (`hosts.ts`), DOM scraping/observation
(`filed-returns-dom.ts`, `filed-returns-observer.ts`), portal navigation and
download triggering (`filed-returns-navigator.ts`,
`filed-returns-download.ts`, `filed-returns-direct-download*.ts`), filter/
search state (`filed-returns-filter-*.ts`, `filed-returns-search-state.ts`),
and the flow/planner glue (`filed-returns-flow.ts`, `planner.ts`). If you're
touching selectors, GST URL shapes, or portal copy, it belongs here — not in
`core`, not in `background/`.

`src/background` is the service-worker-side orchestration layer that calls
into `connectors/gst` (via message passing to the content script) and
`core` (contracts, manifest). It owns ledger/state persistence
(`filed-returns-full-fiscal-year-ledger.ts`, `-recovery.ts`, `-validation.ts`,
`-summary.ts`), the active-run guard (`filed-returns-active-run.ts`), and
download correlation/observation (`download-correlation.ts`,
`download-observer.ts`, `download-observer-results.ts`).

When adding code, prefer extending an existing file in the right layer over
adding a new one — check the anti-bloat checklist in root `AGENTS.md` first.

## Entrypoints

- `entrypoints/background.ts` — the MV3 service worker. Single
  `browser.runtime.onMessage` switch (`PackMessage` union from
  `core/messages.ts`) dispatching to `background/*` functions. Owns the
  storage-key constants (`PACK_LOCAL_STORAGE_KEYS`,
  `PACK_SESSION_STORAGE_KEYS`) and content-script injection/ping logic
  (`ensureContentScript`, `pingContentScript`). Local storage is restricted to
  `TRUSTED_CONTEXTS` on startup.
- `entrypoints/content.ts` — injected only on the four GST host patterns
  (kept in sync with `connectors/gst/hosts.ts` and `manifest-policy.ts`).
  Detects portal context, observes filed-returns page text, and answers the
  `PACK_CONTENT_*` message types by delegating straight into
  `connectors/gst/*`. Guards against double-injection via a
  `window[...]` flag keyed on `PACK_CONTENT_SCRIPT_PROTOCOL_VERSION`.
- `entrypoints/options/` and `entrypoints/popup/` — React UI (`main.tsx` +
  `index.html`, popup also has `components.tsx` and `flow-summary.ts`). These
  talk to the background worker only via `browser.runtime.sendMessage` with
  `PackMessage`s, never by importing `connectors/gst` directly.

## Manifest policy is the single source of truth

`src/extension/manifest-policy.ts` defines `PACK_EXTENSION_PERMISSIONS`
(`["downloads", "offscreen", "scripting", "storage"]`),
`PACK_GST_HOST_PERMISSIONS` (exactly `www.gst.gov.in`,
`services.gst.gov.in`, `return.gst.gov.in`, `gstr2b.gst.gov.in`), the CSP,
name, description, and icons. `wxt.config.ts` imports these constants directly into
`manifest.permissions` / `manifest.host_permissions` — there is no static
`manifest.json` to hand-edit. **Never** add a permission or host anywhere else
(not in `wxt.config.ts`, not in a content-script `matches` array) without
updating `manifest-policy.ts` first, and never expand this list without a
reviewed, evidenced change (see root `AGENTS.md` Non-Negotiables). Any diff
touching this file should trigger `pack-security-reviewer`.

## TypeScript conventions

`tsconfig.json` runs full `strict` plus `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `noUnusedLocals`/`noUnusedParameters`,
`noImplicitReturns`, `noFallthroughCasesInSwitch`. In practice this means:
optional fields are added via conditional spreads (`...(x ? { key: x } : {})`)
rather than `key: x | undefined`; array/map indexing returns `T | undefined`
and must be narrowed before use; every message-handler switch must return on
every branch; unused destructured params get a leading underscore. Follow the
existing style in `core/contracts.ts` and `core/manifest.ts` for new
discriminated unions and conditional-spread object construction.

## Target-bound downloads and MV3 durability

This is the domain logic most likely to be touched here, and the highest-risk
to get subtly wrong:

- A download must always be traceable to an explicit target (fiscal year,
  period, return type, action/run id) — see `DownloadTarget` /
  `FiledReturnsDownloadTarget` in `core/contracts.ts`. A generic "click the
  visible download button" is never sufficient evidence on its own.
- A click is never completion. `background/download-observer.ts` correlates
  `chrome.downloads.onCreated`/`onChanged` events against the expected target
  (`download-correlation.ts`) before calling anything `"completed"`. Unknown
  fileSize/zero-byte/interrupted/ambiguous downloads must resolve to
  `"failed"` or `"not-observed"`, which callers turn into `blocked` /
  `download-unconfirmed` states — never silently into `"downloaded"`.
- Multi-step jobs (see `filed-returns-full-fiscal-year-ledger.ts` and
  `filed-returns-active-run.ts`) persist their state to
  `browser.storage.local` before and after every externally-visible action.
  Do not hold job state only in module-level variables or rely on the popup
  or service worker staying alive — both are killed and restarted by Chrome
  unpredictably. `filed-returns-full-fiscal-year-recovery.ts` and
  `-validation.ts` exist specifically to resume/reconcile a ledger after a
  restart; extend those rather than adding parallel resume logic.
- A "full fiscal year complete" claim requires evidence of surviving both a
  service-worker restart and a browser restart with no duplicate targets and
  no sensitive data persisted anywhere (see `ArchiveManifest.privacy` in
  `core/contracts.ts` — `credentials_collected`, `cookies_collected`,
  `uploaded_to_complyeaze` must stay `false`).

If you touch any file under `background/filed-returns-full-fiscal-year-*.ts`
or `background/download-observer*.ts`, treat root `AGENTS.md`'s
target-bound-download rules as load-bearing, not aspirational.

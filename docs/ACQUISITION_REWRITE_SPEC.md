# Pack — Artifact Acquisition Rewrite Spec (rev 4, FINAL)

**For:** Codex / GPT-5.6 terra-high, goal mode
**Repo:** `pack` (nested extension repo, `/private/tmp/pack-gst-matrix-stabilization`)
**Base commit:** `31ea38e` on `tapish-codex/gst-matrix-stabilization`
**Work branch:** `claude/acquisition-rewrite` (create from `31ea38e`)
**Scope:** GSTR-3B only. GSTR-1 and GSTR-2B are explicitly out (§10).
**Revised:** 2026-07-27, with the GSTR-1/GSTR-2B legacy-capture retention amendment

---

## 0. The premise has changed — read this before anything else

If you carry context from an earlier thread claiming Pack needs **trusted input**,
`event.isTrusted`, user activation, or `chrome.debugger` to drive the GST Portal:
**that premise is experimentally false. Discard it. Do not re-derive it. Do not defend it.**

Live evidence, GSTR-3B filed-return detail page, passive non-suppressing observer:

```
manual mouse click on DOWNLOAD FILED GSTR-3B
  → xhr GET /returns/auth/api/gstr3b/getgenpdf
  → xhr GET /returns/auth/api/gstr3b/taxpayble
  → URL.createObjectURL(Blob type=application/pdf size=40100)
  → file saved

element.click() from the console — IDENTICAL sequence, file saved again
```

Synthetic clicks work. `window.open` is never called. There is no popup-blocker problem,
no user-activation problem, no trusted-event problem.

The save mechanism is FileSaver.js, confirmed on two sibling artifacts:

```
a.dispatchEvent click dl=true scheme=blob
```

**Therefore:** the only remaining explanation for the current "capture armed → 30s timeout →
no artifact" failure is that `src/connectors/gst/main-world-blob-capture.ts` (3,267 lines,
patches 8+ prototypes, **suppresses `window.open`**) breaks the flow it is observing. A
12-line observer that records and passes through sees the whole flow succeed.

---

## 1. THE INVARIANT — Pack persists only portal-produced byte streams

**Pack never persists Pack-produced bytes.**

| Allowed                                       | Forbidden                                     |
| --------------------------------------------- | --------------------------------------------- |
| A Blob the portal constructed, saved verbatim | A PDF Pack rendered                           |
| An HTTP response body saved unmodified        | A JSON Pack reshaped, normalised, or re-keyed |
|                                               | Two portal responses merged into one file     |

The same-origin GSTR-3B preflight endpoint (period parameter redacted) returns ~1.8 KB of JSON holding
the complete return — `r3b.sup_details`, `r3b.itc_elg`, `r3b.tt_val`, `trdnm`, `lglnm`,
`arn`, `arnDt`, `authSig`, `desig`. The portal composes the PDF from this **client-side**.

**You must NOT generate the PDF inside Pack from this JSON.** Not with jsPDF, not with
pdf-lib, not from a template, not "as a fallback", not "for offline mode". A Pack-rendered
document is not the filed return, carries no authentic _Final GSTR-3B_ watermark, and
delivering it to a chartered accountant as their statutory filing is a compliance
misrepresentation. **If you find yourself writing PDF-composition code, stop — you have
taken a wrong turn.**

Saving that same JSON **verbatim as a `.json` artifact is explicitly supported** (§5.3).
The distinction is transformation, not the data.

---

## 2. Root cause of the two historical failures

1. **`accessdenied` on the "direct download" experiment.**
   `src/background/filed-returns-direct-download-trigger.ts:61` passed a portal URL to
   `chrome.downloads.download()` from the **background service worker**. That request
   carries cookies but has no `Referer`, no page `Origin`, and `Sec-Fetch-Site: none`. The
   GST edge layer gates `/returns/auth/api/*` on that shape. `Referer` is a forbidden
   header, so `downloads.download({headers})` cannot fix it.

   The same request from a **content script on a `return.gst.gov.in` page** is genuinely
   same-origin and works. `src/connectors/gst/filed-returns-api-search.ts` already proves
   this in production (`POST /returns/auth/api/efiledReturns`,
   `GET /returns/auth/api/rolestatus`, `credentials: "same-origin"`).

   Nobody isolated request-context as a variable. That is the whole bug.

2. **"Armed then timeout" on the capture path.** Over-broad, suppressing instrumentation. §0.

**Privacy note that must survive review:** none of this reads, stores, logs, or transmits a
cookie, token, header, or any session material. The browser attaches credentials to a
same-origin request exactly as it does for the page's own code. This is not session replay,
and the `filed-returns-api-search.ts` precedent was already reviewed on that basis.

---

## 3. Architectural principle

The old design conflated two questions:

- _How do we prove a download happened?_ → completion invariant. Correct. **Keep.**
- _How do we make the download happen?_ → acquisition mechanism.

The evidence policy was applied to **acquisition**. That forced click-and-observe, which
forced a capture layer to dodge the Save dialog, which forced the trusted-input dead end.

**New principle: Pack owns acquisition. Target-binding becomes constructive, not
correlative.** Pack requests exactly one artifact for exactly one
(returnType, artifactType, FY, period). There is no "which download was that?" problem left.
Heuristic correlation degrades from load-bearing beam to a confirmation on a known
`downloadId`.

---

## 4. Target architecture

```
popup selection
  └─> background: ArtifactRequest { returnType, artifactType, FY, period, returnPeriod, requestId }
        └─> content script on return.gst.gov.in            [page context, same-origin]
              guard: correct origin + correct detail page
              PREFLIGHT: fetch getgenpdf, assert data.r3b.ret_period === returnPeriod   (§5.2)
              acquire bytes via this descriptor's strategy                               (§5.3/§5.4)
              validate magic bytes + size + shape                                        (§6)
              return { ok, base64, mimeType, safeSignals }
        └─> background: bytes → data URL (small) or offscreen blob URL (large)
        └─> chrome.downloads.download({ saveAs: false, filename, conflictAction: "uniquify" })
        └─> await downloads.onChanged for THIS downloadId → "complete", bytesReceived > 0
        └─> mark target downloaded
```

Properties:

- **No native Save sheet, ever.** `saveAs: false` on an extension-initiated download
  bypasses the file chooser regardless of the user's "ask where to save each file"
  preference. **The test machine has that preference ON** — so during live QA, _a visible
  save dialog means suppression failed_. Treat it as a hard failure signal.
- Bytes are in memory, so **ZIP bundling works** — a product requirement, and the reason
  passive observation of the page's own download is not sufficient.
- Retry is safe and idempotent → "ambiguous outcome → manual review" collapses to
  "N failures → blocked, with a reason enum".
- Identical on Chrome and Brave.

---

## 5. Acquisition

### 5.1 Contract — `src/connectors/gst/artifact-source.ts`

Runs in the content script. The **only** place that obtains artifact bytes.

```ts
export type ArtifactRequest = {
  returnType: "GSTR-3B"; // widened in a later lane, see §10
  artifactType: "PDF" | "JSON";
  financialYear: string; // "2024-25"
  period: string; // "April"
  returnPeriod: string; // portal MMYYYY, e.g. "042024"
  requestId: string; // opaque target identity, echoed back
};

export type ArtifactFailureReason =
  | "unsupported-target"
  | "wrong-page"
  | "control-not-found"
  | "preflight-failed"
  | "target-period-mismatch"
  | "endpoint-unavailable"
  | "http-error"
  | "not-authenticated"
  | "unexpected-content"
  | "empty"
  | "too-large"
  | "generation-timeout";

export type ArtifactResult =
  | { ok: true; requestId: string; bytes: Uint8Array; mimeType: string; safeSignals: string[] }
  | { ok: false; requestId: string; reason: ArtifactFailureReason; safeSignals: string[] };

export async function acquireFiledReturnArtifact(
  documentRef: Document,
  request: ArtifactRequest,
): Promise<ArtifactResult>;
```

Hard rules:

- **Never** log, persist, or return a URL, query string, response body, header, cookie, or
  any portal text. `safeSignals` are enum-like category strings only.
- **Never** return `ok: true` without passing §6 validation.
- Fail closed. Any unexpected shape → `ok: false` with the nearest reason. Never guess.
- Guard page identity **before** acquiring: origin `https://return.gst.gov.in` and the
  pathname must match the expected detail page. Reuse `detectFiledReturnDetailPage`.

### 5.2 Preflight target binding (replaces DOM fingerprinting)

Before acquiring either artifact:

```
same-origin GSTR-3B preflight endpoint (period parameter redacted)   credentials: "same-origin"
  → non-200                              → "preflight-failed"
  → body.status !== 1                    → "preflight-failed"
  → body.data.r3b.ret_period !== returnPeriod → "target-period-mismatch"   [HARD FAIL]
  → else                                 → signal "target-period-verified"
```

This is the portal asserting which period the data belongs to. It is stronger evidence than
any DOM inspection and replaces the "visible control fingerprint" machinery.

**Never persist or log `gstin`, `ret_period`, `arn`, `lglnm`, `trdnm`, or any field value.**
Compare in memory; emit only the enum signal. Assert this in tests.

For `artifactType: "JSON"`, the preflight response body **is** the artifact — reuse the
already-fetched bytes; do not re-request.

### 5.3 Strategy A — `server-fetch` (GSTR-3B JSON)

The preflight response, saved **verbatim**. Take the raw response bytes
(`await response.arrayBuffer()`), not `JSON.stringify(await response.json())` — a
re-serialise is a transformation and violates §1. Validate per §6, deliver per §7.

Filename: `Pack/<FY>/<Period>/GSTR-3B-data.json`
UI label: **"portal data (JSON)"** — never "filed return".

### 5.4 Strategy B — `page-generated` (GSTR-3B PDF)

The portal builds the PDF in the page. Let it, capture the Blob, and suppress only the
page's own save so the user does not get an uncontrolled duplicate.

**New file: `src/connectors/gst/portal-blob-shim.ts` — HARD CAP 120 LINES.**
This replaces `main-world-blob-capture.ts` (3,267 lines). **If your implementation exceeds
120 lines, stop and re-read §0** — you have misunderstood the task.

Injected via `chrome.scripting.executeScript({ world: "MAIN" })`. It must:

1. Wrap **exactly two** prototypes: `HTMLAnchorElement.prototype.dispatchEvent` and
   `HTMLAnchorElement.prototype.click`, plus `URL.createObjectURL`. (Live evidence shows
   `dispatchEvent`; cover `click` defensively.)
2. **Suppress nothing except an exact match.** Swallow an anchor activation only when
   `anchor.href === theBlobUrlJustRecorded`. Never suppress by heuristic, by the `download`
   attribute alone, or by URL pattern. An unrelated anchor must be unaffected — this needs a
   regression test.
3. **Never patch** `window.open`, `fetch`, `XMLHttpRequest`, `Node.appendChild`,
   `HTMLFormElement.submit`, or anything else. The previous implementation did; that is why
   it failed.
4. Record only Blobs whose `type` is `application/pdf`. Ignore all others.
5. Restore all wrapped members in a `finally` — on success, error **and** timeout. Verified
   by test.
6. Be one-shot: arm → click → first matching blob wins → disarm. A later blob is ignored.
7. Emit `"portal-blob-shim-suppressed-via-dispatchEvent"` or `"…-via-click"` so the first
   live run confirms which path fired.
8. Return only bytes and enum signals across the boundary. No portal text, ever.

Sequence:

```
guard detail page → preflight (§5.2) → locate verified control
  → arm shim (MAIN world) → shim acknowledges armed
  → content script clicks the control                    [proven to work — §0]
  → shim records first application/pdf Blob, suppresses that one anchor activation
  → FileReader → bytes → content script → §6 validation → §7 delivery
  → on timeout (20s): restore, disarm, return "generation-timeout"
                      NEVER complete, NEVER blind-retry
```

**Background safety net.** While a `page-generated` target is armed, if
`chrome.downloads.onCreated` fires for a `blob:` URL from the portal tab, suppression
missed: call `downloads.cancel(id)` then `downloads.erase(id)` and record
`"portal-blob-shim-suppression-missed"`. Guarantees no stray uncontrolled file. Test it.

### 5.5 Message protocol

Bump `PACK_CONTENT_SCRIPT_PROTOCOL_VERSION` 33 → 34 in `src/connectors/gst/messages.ts` so
stale injected content scripts cannot serve the new request with old behaviour.

```
PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34
  request:  ArtifactRequest
  response: { ok: true;  requestId; base64: string; mimeType: string; safeSignals: string[] }
          | { ok: false; requestId; reason: ArtifactFailureReason; safeSignals: string[] }
```

Bytes cross as base64 (large `Uint8Array` structured clone through `runtime.sendMessage` is
unreliable across Chromium builds). A 40 KB PDF → ~54 KB string. Guard: `bytes.length > 20 MB`
→ `too-large`. Wire it in `src/entrypoints/content.ts` beside the existing `…_V3` handlers.

---

## 6. Validation — `src/connectors/gst/artifact-validation.ts` (~70 lines)

```ts
export function validateArtifactBytes(
  bytes: Uint8Array,
  artifactType: "PDF" | "JSON",
  expectedReturnPeriod: string,
):
  | { ok: true; mimeType: string }
  | { ok: false; reason: "empty" | "too-large" | "unexpected-content" | "target-period-mismatch" };
```

- `PDF`: starts with `%PDF-` (25 50 44 46 2D); size `[1 KB, 25 MB]`; mime `application/pdf`.
- `JSON`: parses; `status === 1`; `data.r3b.ret_period === expectedReturnPeriod`;
  size `[100 B, 25 MB]`; mime `application/json`.
- Anything else → `unexpected-content`.

This is what stops an `accessdenied` HTML page being saved with a `.pdf` name.
Non-negotiable. Test with a **synthetic** access-denied HTML fixture — do not commit real
portal HTML.

---

## 7. Delivery and completion — reuse, do not rewrite

Reuse as-is: `captured-download-data-url.ts` (109), `offscreen-blob-url.ts` (266),
`entrypoints/offscreen/main.ts` (339), `download-observer.ts` (223).

New thin orchestrator: **`src/background/artifact-download.ts` (~150 lines)**

```ts
export async function downloadAcquiredArtifact(input: {
  requestId: string;
  base64: string;
  mimeType: string;
  filename: string;
}): Promise<
  | { ok: true; downloadId: number; bytesReceived: number; safeSignals: string[] }
  | {
      ok: false;
      reason: "start-rejected" | "interrupted" | "empty" | "timeout";
      safeSignals: string[];
    }
>;
```

- Data URL when `base64.length <= 1_500_000`, else offscreen blob URL. Always revoke the
  blob URL and close the offscreen document in a `finally`.
- Always `saveAs: false`, `conflictAction: "uniquify"`.
- Await `downloads.onChanged` **for the returned `downloadId` only**. Complete requires
  `state === "complete"` **and** `bytesReceived > 0`. Timeout 30 s → `timeout`; target goes
  to blocked-with-reason, never complete.
- **Nothing else may mark a target complete.** Delete every other path that can.

**Completion invariant, restated:** a target is complete iff Pack obtained bytes that passed
§6 validation **and** the extension-initiated download with the known `downloadId` reached
`state: "complete"` with `bytesReceived > 0`.

**Filenames** — deterministic, local-only:

```
Pack/<FY>/<Period>/GSTR-3B.pdf
Pack/<FY>/<Period>/GSTR-3B-data.json
```

No GSTIN, PAN, ARN, or taxpayer name in filenames. Persist only a `filenameClass` category
string in run state, matching existing practice — never the resolved path.

---

## 8. Deletions

Delete these and their tests when their only remaining callers are the retired GSTR-3B capture
path. Trace every caller. **No compatibility shims. No deprecation stubs.**

**Amendment (2026-07-27):** retain `src/connectors/gst/main-world-blob-capture.ts` until
GSTR-1 and GSTR-2B have migrated: both protected flows genuinely still call it. Retain any
other listed module with a legitimate GSTR-1 or GSTR-2B caller and report that caller. This
lane must instead sever GSTR-3B completely from legacy capture: no GSTR-3B PDF, JSON, or
period may reach it. A GSTR-3B full-fiscal-year request is blocked with
`gstr3b-full-fiscal-year-acquisition-not-wired`; it must not fall back or loop.

```
src/background/main-world-capture-executor.ts                      (229 → replaced by a thin arm/inject helper)
src/background/main-world-capture-contracts.ts
src/connectors/gst/filed-returns-portal-blob-capture.ts            (104)
src/background/filed-returns-captured-download.ts
src/background/filed-returns-captured-evidence.ts
src/background/filed-returns-captured-extension-download.ts
src/background/filed-returns-captured-portal-guard.ts
src/background/filed-returns-captured-rejected.ts
src/background/filed-returns-captured-signals.ts
src/background/filed-returns-captured-staging.ts
src/background/filed-returns-target-bound-portal-candidate.ts
src/background/filed-returns-target-bound-portal-download.ts
src/background/filed-returns-target-download-attempt.ts
src/background/filed-returns-target-download-attempt-validation.ts
src/background/filed-returns-direct-download-trigger.ts            (replaced by artifact-download.ts)
src/connectors/gst/filed-returns-direct-download-authorization.ts  (endpoint knowledge → artifact-source.ts)
src/connectors/gst/filed-returns-download-candidates.ts            (if only reachable from the capture path)
src/connectors/gst/filed-returns-target-bound-download-candidate.ts
```

Review for deletion or heavy simplification once the above is gone:

```
src/background/filed-returns-target-review.ts        (357)
src/background/filed-returns-target-download-recovery.ts
src/background/download-correlation.ts               (82 — heuristic matching obsolete)
src/background/download-evidence-signals.ts
src/background/filed-returns-download-diagnostics.ts
src/background/filed-returns-download-diagnostic-state.ts
src/connectors/gst/filed-returns-download-diagnostic-compatibility.ts
```

**Do NOT delete in this pass:** `filed-returns-full-fiscal-year-*`. Separate lane (§11).

Expected reduction: **~8–12 k lines `src`, ~15–20 k lines `tests`.** An estimate, not a
target. If a file has legitimate non-capture callers, keep it and say so in the report. **Do
not delete anything you cannot justify in order to hit a number.**

---

## 9. Tests

Delete tests for deleted modules. Add:

**`tests/connectors/artifact-validation.test.ts`**

- `%PDF-` + 40 KB → ok, `application/pdf`
- synthetic access-denied HTML → `unexpected-content`
- JSON with `status: 0` → `unexpected-content`
- JSON with mismatched `ret_period` → `target-period-mismatch`
- 0 bytes → `empty`; 40 MB → `too-large`

**`tests/connectors/artifact-source.test.ts`** (stub `documentRef.defaultView.fetch`)

- preflight ok + JSON request → returns the **raw response bytes**, byte-identical to the
  stubbed body (assert no re-serialise: stub a body with unusual key order/whitespace and
  assert exact equality)
- preflight `ret_period` mismatch → `target-period-mismatch`, **and no click is attempted**
- preflight HTTP 403 → `preflight-failed`
- wrong origin / wrong pathname → `wrong-page`, **and fetch is never called**
- assert no `safeSignal` contains `"http"`, `"gst.gov.in"`, `"?"`, `"/"`, or any digit
  sequence of length ≥ 6 (guards against period/GSTIN leaking into diagnostics)

**`tests/connectors/portal-blob-shim.test.ts`** — highest-value suite in this change

- arm → matching `application/pdf` blob → bytes returned, one-shot disarm
- **an unrelated anchor on the page is NOT suppressed** (the exact regression that killed the
  old implementation)
- a non-`application/pdf` blob is ignored
- all wrapped members restored on success, on timeout, and on throw
- a second blob after disarm is ignored
- `window.open`, `fetch`, `XMLHttpRequest` are **never** patched (assert identity before/after)
- suppression fires for `dispatchEvent` and for `click`, matched on blob-URL identity
- shim source is ≤ 120 lines (assert it — it is the design constraint)

**`tests/background/artifact-download.test.ts`**

- start → complete, `bytesReceived > 0` → `ok: true`
- interrupted → `interrupted`, target NOT complete
- `"complete"` with `bytesReceived === 0` → `empty`, target NOT complete
- an unrelated `downloadId` completing does **not** satisfy the wait
- no `onChanged` in 30 s → `timeout`, `downloads.download` called exactly once
- offscreen blob URL revoked and offscreen document closed on every exit path
- `saveAs: false` asserted on **every** call
- safety net: `onCreated` with a portal `blob:` URL while armed → `cancel` + `erase`

**`tests/entrypoints/content-protocol.test.ts`**

- a `…_V33` request is rejected by the `V34` content script

**Repo-wide guard test** — assert no source file imports `jspdf`, `pdf-lib`, `pdfmake`, or
`pdfkit`, and that `package.json` lists none of them (§1, made mechanical).

---

## 10. Out of scope — do not implement

- **GSTR-1.** Live diagnostics traced `DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)` →
  `/einvoice/auth/api/geteinvdata`, which is the **e-invoice subsystem, not GSTR-1**. Wiring
  it would have silently delivered the wrong document with a fully successful download.
  `/returns/auth/gstr1/gstr1sum` → `DOWNLOAD SUMMARY (PDF)` is the GSTR-1 _summary_, not the
  filed GSTR-1 details (which use a third async generate-then-poll mechanism). GSTR-1 needs
  artifact-identity diagnostics first. **Do not add a GSTR-1 descriptor.**
- **GSTR-2B.** Leave the existing 2B flow untouched.
- **ZIP / full-fiscal-year.** The architecture supports it; wiring it is the next lane. Until
  then, a GSTR-3B full-fiscal-year request is blocked rather than falling back to legacy
  capture.
- **`chrome.debugger`.** Premise falsified (§0). The staged deletion of
  `gstr1-debugger-view.ts` was correct; do not reinstate it.
- **Any new permission.** Net delta must be zero: `downloads`, `offscreen`, `scripting`,
  `storage`, and exactly the four GST hosts.

---

## 11. Commit lanes

1. `feat(gst): add page-context artifact acquisition contract and validation` — §5.1–5.3, §6, tests
2. `feat(gst): add bounded portal blob shim for page-generated artifacts` — §5.4, tests
3. `feat(download): deliver acquired artifacts through extension-owned downloads` — §7, §5.5, tests
4. `refactor(gst): sever GSTR-3B from main-world capture acquisition` — §8 deletions where
   unshared, retained GSTR-1/GSTR-2B callers recorded, and test removals

Follow-on lanes, **not** this PR: GSTR-1 artifact identity; ZIP/full-fiscal-year
simplification (resume becomes "which of the N requests have not yet produced validated
bytes", which should collapse most of the 7.7 k lines in that theme).

---

## 12. Required checks

```sh
pnpm install --frozen-lockfile
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
git diff --check
```

Plus the `pack-security-reviewer` and `pack-privacy-reviewer` subagents.

---

## 13. Acceptance criteria

1. A filed GSTR-3B PDF for a selected FY + period downloads end to end with **zero** user
   interaction after Start and **zero** native Save dialogs — on a machine where Chrome's
   "ask where to save each file" is **ON**.
2. The saved PDF is byte-identical to the portal's own download (~40 KB, `%PDF-`, _Final
   GSTR-3B_ watermark). **No PDF-composition code exists anywhere in the tree** (§1).
3. The JSON artifact is byte-identical to the raw `getgenpdf` response body.
4. Exactly **one** file per artifact — the shim suppressed the page's save, or the safety net
   cancelled it.
5. A forced failure (403, HTML body, or period mismatch) leaves the target **not complete**,
   surfaces a reason enum, and writes no file.
6. No `safeSignal`, storage value, or log line contains a URL, query string, response body,
   header, cookie, GSTIN, PAN, ARN, taxpayer name, return period, or local path.
7. `portal-blob-shim.ts` is ≤ 120 lines.
8. Permission set unchanged.

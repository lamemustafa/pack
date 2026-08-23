import { browser } from "wxt/browser";
import {
  PACK_OFFSCREEN_BLOB_URL_TARGET,
  isPackOffscreenFiledReturnSummaryErrorCategory,
  isPackOffscreenFiledReturnZipErrorCategory,
  type PackOffscreenBlobUrlResponse,
  type PackOffscreenFiledReturnZipErrorCategory,
  type PackOffscreenFiledReturnZipExpectedEntry,
  type PackOffscreenFiledReturnSummaryResult,
} from "../connectors/gst/offscreen-blob-url";
import type { FiledReturnsSummaryPlanEntry } from "../connectors/gst/filed-returns-summary-sheet";
import { MAX_FILED_RETURNS_SUMMARY_ROWS } from "../connectors/gst/filed-returns-summary-sheet";
import type { FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import type { FiledReturnsReturnType } from "../connectors/gst/filed-returns-return-types";
import { MAX_ARTIFACT_BYTES } from "../connectors/gst/artifact-validation";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const OFFSCREEN_JUSTIFICATION =
  "Create and revoke a temporary Blob URL for an explicit local GST return download.";
export type OffscreenFiledReturnStageResult =
  { status: "staged" } | { status: "failed"; errorCategory?: string };
export type OffscreenFiledReturnZipResult =
  | {
      status: "created";
      blobUrl: string;
      zipEntryCount: number;
      artifactEntryCount: number;
      summary?: PackOffscreenFiledReturnSummaryResult;
    }
  | { status: "failed"; errorCategory?: PackOffscreenFiledReturnZipErrorCategory };
export type OffscreenFiledReturnClearResult =
  | { status: "cleared" }
  | {
      status: "failed";
      errorCategory?:
        | "clear-failed"
        | "offscreen-response-invalid"
        | "offscreen-unreachable"
        | "opfs-unavailable";
    };

type StagedReceiptExpectation = {
  artifactType: FiledReturnsConcreteArtifactType;
  ledgerId: string;
  returnType: FiledReturnsReturnType;
  zipPath: string;
};

let creatingOffscreenDocument: Promise<void> | null = null;

export async function createOffscreenBlobUrl(dataUrl: string): Promise<string | null> {
  const requestId = createRequestId();
  await ensureOffscreenDocument();
  const response = await browser.runtime.sendMessage({
    type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
    target: PACK_OFFSCREEN_BLOB_URL_TARGET,
    payload: {
      requestId,
      dataUrl,
    },
  });
  return isBlobUrlResponse(response, requestId) ? response.blobUrl : null;
}

export async function stageOffscreenFiledReturn({
  artifactType,
  dataUrl,
  ledgerId,
  returnType,
  zipPath,
}: {
  artifactType: FiledReturnsConcreteArtifactType;
  dataUrl: string;
  ledgerId: string;
  returnType: FiledReturnsReturnType;
  zipPath: string;
}): Promise<OffscreenFiledReturnStageResult> {
  const requestId = createRequestId();
  await ensureOffscreenDocument();
  const response = await browser.runtime.sendMessage({
    type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
    target: PACK_OFFSCREEN_BLOB_URL_TARGET,
    payload: {
      requestId,
      artifactType,
      dataUrl,
      ledgerId,
      returnType,
      zipPath,
    },
  });
  return toStageResult(response, requestId, { artifactType, ledgerId, returnType, zipPath });
}

export async function createOffscreenFiledReturnZipUrl(
  ledgerId: string,
  expected: {
    returnType: FiledReturnsReturnType;
    entryCount: number;
    entries: readonly PackOffscreenFiledReturnZipExpectedEntry[];
    generatedAt: Date;
    summaryPlan?: readonly FiledReturnsSummaryPlanEntry[];
  },
): Promise<OffscreenFiledReturnZipResult> {
  const requestId = createRequestId();
  await ensureOffscreenDocument();
  const response = await browser.runtime.sendMessage({
    type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
    target: PACK_OFFSCREEN_BLOB_URL_TARGET,
    payload: {
      requestId,
      ledgerId,
      expectedReturnType: expected.returnType,
      expectedEntryCount: expected.entryCount,
      expectedEntries: [...expected.entries],
      generatedAt: expected.generatedAt.toISOString(),
      ...(expected.summaryPlan ? { summaryPlan: [...expected.summaryPlan] } : {}),
    },
  });
  return toZipResult(response, requestId, expected);
}

export async function clearOffscreenFiledReturnLedger(
  ledgerId: string,
): Promise<OffscreenFiledReturnClearResult> {
  const requestId = createRequestId();
  try {
    await ensureOffscreenDocument();
    const response = await browser.runtime.sendMessage({
      type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId,
        ledgerId,
      },
    });
    return toClearResult(response, requestId);
  } catch {
    return { status: "failed", errorCategory: "offscreen-unreachable" };
  }
}

export async function clearAllOffscreenFiledReturnLedgers(): Promise<OffscreenFiledReturnClearResult> {
  const requestId = createRequestId();
  try {
    await ensureOffscreenDocument();
    const response = await browser.runtime.sendMessage({
      type: "PACK_OFFSCREEN_CLEAR_ALL_FILED_RETURN_LEDGERS",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: { requestId },
    });
    return toClearResult(response, requestId);
  } catch {
    return { status: "failed", errorCategory: "offscreen-unreachable" };
  }
}

export async function revokeOffscreenBlobUrl(blobUrl: string): Promise<void> {
  const requestId = createRequestId();
  try {
    await browser.runtime.sendMessage({
      type: "PACK_OFFSCREEN_REVOKE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId,
        blobUrl,
      },
    });
  } catch {
    // The browser may already have torn down the offscreen document.
  }
}

export async function closeOffscreenBlobDocument(): Promise<void> {
  const offscreenApi = getOffscreenApi();
  try {
    await offscreenApi?.closeDocument();
  } catch {
    // Another extension task or the browser may have already closed it.
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreenDocument) {
    const offscreenApi = getOffscreenApi();
    if (!offscreenApi) throw new Error("Pack offscreen API unavailable.");
    creatingOffscreenDocument = offscreenApi
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["BLOBS"],
        justification: OFFSCREEN_JUSTIFICATION,
      })
      .finally(() => {
        creatingOffscreenDocument = null;
      });
  }
  await creatingOffscreenDocument;
}

async function hasOffscreenDocument(): Promise<boolean> {
  const runtimeWithContexts = browser.runtime as typeof browser.runtime & {
    getContexts?: (filter: {
      contextTypes: ["OFFSCREEN_DOCUMENT"];
      documentUrls: string[];
    }) => Promise<unknown[]>;
  };
  if (!runtimeWithContexts.getContexts) return false;
  const offscreenUrl = browser.runtime.getURL(
    OFFSCREEN_DOCUMENT_PATH as Parameters<typeof browser.runtime.getURL>[0],
  );
  const contexts = await runtimeWithContexts.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });
  return contexts.length > 0;
}

function getOffscreenApi(): {
  createDocument(parameters: {
    url: string;
    reasons: ["BLOBS"];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
} | null {
  const browserWithOffscreen = browser as typeof browser & {
    offscreen?: {
      createDocument(parameters: {
        url: string;
        reasons: ["BLOBS"];
        justification: string;
      }): Promise<void>;
      closeDocument(): Promise<void>;
    };
  };
  return browserWithOffscreen.offscreen ?? null;
}

function isBlobUrlResponse(
  response: unknown,
  requestId: string,
): response is Extract<PackOffscreenBlobUrlResponse, { blobUrl: string }> {
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  return record.ok === true && record.requestId === requestId && typeof record.blobUrl === "string";
}

function isStagedResponse(
  response: unknown,
  requestId: string,
  expected: StagedReceiptExpectation,
): response is { ok: true; requestId: string; staged: true } {
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  return (
    record.ok === true &&
    record.requestId === requestId &&
    record.staged === true &&
    record.byteCountClass === "non-empty" &&
    record.artifactType === expected.artifactType &&
    record.ledgerId === expected.ledgerId &&
    record.returnType === expected.returnType &&
    record.zipPath === expected.zipPath &&
    typeof record.byteCount === "number" &&
    Number.isSafeInteger(record.byteCount) &&
    record.byteCount > 0 &&
    record.byteCount <= MAX_ARTIFACT_BYTES
  );
}

function toStageResult(
  response: unknown,
  requestId: string,
  expected: StagedReceiptExpectation,
): OffscreenFiledReturnStageResult {
  if (isStagedResponse(response, requestId, expected)) return { status: "staged" };
  if (typeof response === "object" && response !== null) {
    const record = response as Record<string, unknown>;
    if (
      record.ok === false &&
      record.requestId === requestId &&
      typeof record.errorCategory === "string"
    ) {
      return { status: "failed", errorCategory: record.errorCategory };
    }
  }
  return { status: "failed" };
}

function isZipResponse(
  response: unknown,
  requestId: string,
  expected: {
    entryCount: number;
    summaryPlan?: readonly FiledReturnsSummaryPlanEntry[];
  },
): response is {
  ok: true;
  requestId: string;
  blobUrl: string;
  zipEntryCount: number;
  artifactEntryCount: number;
  summaryEntryCount: number;
  summary?: unknown;
} {
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  return (
    record.ok === true &&
    record.requestId === requestId &&
    typeof record.blobUrl === "string" &&
    typeof record.zipEntryCount === "number" &&
    Number.isInteger(record.zipEntryCount) &&
    record.artifactEntryCount === expected.entryCount &&
    (record.summaryEntryCount === 0 ||
      ((record.summaryEntryCount === 1 || record.summaryEntryCount === 2) &&
        expected.summaryPlan !== undefined)) &&
    record.zipEntryCount === record.artifactEntryCount + record.summaryEntryCount &&
    (expected.summaryPlan !== undefined || record.summary === undefined)
  );
}

function toZipResult(
  response: unknown,
  requestId: string,
  expected: {
    entryCount: number;
    summaryPlan?: readonly FiledReturnsSummaryPlanEntry[];
  },
): OffscreenFiledReturnZipResult {
  if (isZipResponse(response, requestId, expected)) {
    const summary =
      expected.summaryPlan && isSummaryResult(response.summary, expected.summaryPlan)
        ? response.summary
        : undefined;
    // GSTR-2B ships the workbook alone once it has one, because its tidy CSV
    // carries no invoice rows; GSTR-3B ships both. So a produced workbook means
    // one entry for GSTR-2B and two for GSTR-3B, and any no-workbook outcome
    // means one either way.
    // Two entries unless the receipt says the workbook shipped alone. A GSTR-2B
    // workbook without ITC totals travels with the CSV, and that receipt omits
    // `workbookOnly` -- so the count follows the flag rather than the return
    // type, which was the assumption that made the fallback unreachable.
    const expectedSummaryEntryCount =
      summary?.status !== "included"
        ? 0
        : summary.workbookOutcome !== undefined || summary.workbookOnly === true
          ? 1
          : 2;
    const summaryCountMatches = response.summaryEntryCount === expectedSummaryEntryCount;
    if (expected.summaryPlan && (!summary || !summaryCountMatches)) {
      return { status: "failed", errorCategory: "offscreen-response-invalid" };
    }
    return {
      status: "created",
      blobUrl: response.blobUrl,
      zipEntryCount: response.zipEntryCount,
      artifactEntryCount: response.artifactEntryCount,
      ...(summary ? { summary } : {}),
    };
  }
  if (typeof response === "object" && response !== null) {
    const record = response as Record<string, unknown>;
    if (
      record.ok === false &&
      record.requestId === requestId &&
      isPackOffscreenFiledReturnZipErrorCategory(record.errorCategory)
    ) {
      return { status: "failed", errorCategory: record.errorCategory };
    }
  }
  return { status: "failed" };
}

function isSummaryResult(
  input: unknown,
  plan: readonly FiledReturnsSummaryPlanEntry[],
): input is PackOffscreenFiledReturnSummaryResult {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  if (record.status === "failed") {
    return (
      hasOnlyKeys(record, ["reasonCategory", "status"]) &&
      isPackOffscreenFiledReturnSummaryErrorCategory(record.reasonCategory)
    );
  }
  const maximumParsedPeriodCount = new Set(
    plan
      .filter((entry) => entry.artifactType === "JSON" && entry.outcomeCategory === "staged")
      .map((entry) => entry.period),
  ).size;
  const returnType = plan[0]?.returnType;
  // Eligibility, not an exact expectation. A workbook-eligible plan may
  // legitimately emit no workbook -- a GSTR-2B year whose staged JSON carries no
  // supported `docdata` section returns the CSV alone with "not-applicable" --
  // and requiring `undefined` rejected that valid receipt, which blocked the
  // whole ZIP. Fail-closed belongs on the artifact's evidence, not on a
  // re-derivation of what the worker should have decided; the CSV discarded here
  // had already passed its privacy screen.
  // Per return type, not per eligibility. GSTR-3B can only produce a workbook
  // plus CSV or a failed summary, so accepting the CSV-only outcomes for it
  // would let a stale or malformed receipt through as an incomplete ZIP.
  const homogeneous = plan.every((entry) => entry.returnType === returnType);
  const permittedWorkbookOutcomes: readonly (string | undefined)[] =
    homogeneous && returnType === "GSTR-2B"
      ? // A PDF-only selection, or one whose JSON is artifact-unavailable, never
        // had a source to build from and reports `no-source`. `not-applicable`
        // stays out: for GSTR-2B it is not reachable, and accepting it would let
        // a stale receipt render "not available for this return type" about a
        // return type that supports one.
        [undefined, "no-records", "no-source", "unavailable"]
      : homogeneous && returnType === "GSTR-3B"
        ? [undefined]
        : ["not-applicable"];
  return (
    hasOnlyKeys(record, [
      "outcomeOnly",
      "parsedPeriodCount",
      "rowCount",
      "status",
      "workbookOnly",
      "workbookOutcome",
    ]) &&
    record.status === "included" &&
    permittedWorkbookOutcomes.includes(record.workbookOutcome as string | undefined) &&
    // Combinations, not fields. Only the GSTR-2B workbook is built from staged
    // JSON, so only there does a produced workbook imply a parsed period; the
    // GSTR-3B workbook is built from the run's own outcome rows and legitimately
    // reports none. Applying the GSTR-2B rule to every return type rejected that
    // producer receipt and dropped an assembled ZIP before its download started.
    (returnType !== "GSTR-2B" ||
      !homogeneous ||
      record.workbookOutcome !== undefined ||
      (record.parsedPeriodCount as number) > 0) &&
    // The absence reasons are not interchangeable, and each is reachable from
    // exactly one producer state.
    //
    // `no-source` means nothing was staged, and the plan is what says whether
    // anything was -- so it binds to `maximumParsedPeriodCount`, derived here
    // from the request, and not to `parsedPeriodCount`, which the receipt
    // asserts. Checking the receipt's own count against the receipt's own
    // outcome asks the untrusted side to corroborate itself: a response that is
    // stale or wrong about one is wrong about the other in the same way, and
    // agrees with itself perfectly. A staged-JSON plan whose receipt claims no
    // source is exactly that response, and it would have delivered a ZIP
    // stating a false reason for a missing workbook.
    (record.workbookOutcome !== "no-source" || maximumParsedPeriodCount === 0) &&
    (record.workbookOutcome !== "no-records" || maximumParsedPeriodCount > 0) &&
    // A successful GSTR-2B workbook ships alone, so the flag is required rather
    // than optional there, and refused beside any CSV-only outcome -- without
    // it the status message claims a tidy CSV the ZIP does not contain.
    // A GSTR-2B workbook ships alone only when it carries the ITC totals that
    // justify dropping the CSV. Without them the worker ships both and omits the
    // flag, so requiring it unconditionally rejected that valid receipt.
    (returnType === "GSTR-2B" && homogeneous
      ? record.workbookOnly === undefined || record.workbookOnly === true
      : record.workbookOnly === undefined) &&
    (record.workbookOnly !== true || record.workbookOutcome === undefined) &&
    typeof record.outcomeOnly === "boolean" &&
    typeof record.parsedPeriodCount === "number" &&
    Number.isInteger(record.parsedPeriodCount) &&
    record.parsedPeriodCount >= 0 &&
    record.parsedPeriodCount <= maximumParsedPeriodCount &&
    (record.outcomeOnly === true
      ? record.parsedPeriodCount === 0
      : record.parsedPeriodCount >= 1) &&
    typeof record.rowCount === "number" &&
    Number.isInteger(record.rowCount) &&
    record.rowCount >= plan.length &&
    record.rowCount >= record.parsedPeriodCount &&
    record.rowCount <= MAX_FILED_RETURNS_SUMMARY_ROWS
  );
}

function hasOnlyKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(input).every((key) => allowed.has(key));
}

function isClearedResponse(
  response: unknown,
  requestId: string,
): response is { ok: true; requestId: string; cleared: true } {
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  return record.ok === true && record.requestId === requestId && record.cleared === true;
}

function toClearResult(response: unknown, requestId: string): OffscreenFiledReturnClearResult {
  if (isClearedResponse(response, requestId)) return { status: "cleared" };
  if (typeof response === "object" && response !== null) {
    const record = response as Record<string, unknown>;
    if (
      record.ok === false &&
      record.requestId === requestId &&
      (record.errorCategory === "clear-failed" || record.errorCategory === "opfs-unavailable")
    ) {
      return { status: "failed", errorCategory: record.errorCategory };
    }
  }
  return { status: "failed", errorCategory: "offscreen-response-invalid" };
}

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `offscreen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

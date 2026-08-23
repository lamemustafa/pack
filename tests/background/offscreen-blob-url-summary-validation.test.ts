import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  response: {} as unknown,
  runtime: {
    getContexts: vi.fn(async () => [{}]),
    getURL: vi.fn(() => "chrome-extension://pack/offscreen.html"),
    sendMessage: vi.fn(async (_message?: unknown) => {
      void _message;
      return mocks.response;
    }),
  },
}));

vi.mock("wxt/browser", () => ({ browser: { runtime: mocks.runtime } }));

import { createOffscreenFiledReturnZipUrl } from "../../src/background/offscreen-blob-url";

describe("offscreen full-year summary response validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds included row and parsed-period counts to the requested summary plan", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => {
      const requestId = requestIdFrom(message);
      return {
        ok: true,
        requestId,
        blobUrl: "blob:pack/summary",
        zipEntryCount: 2,
        artifactEntryCount: 1,
        summaryEntryCount: 1,
        summary: {
          status: "included",
          workbookOutcome: "not-applicable",
          outcomeOnly: false,
          parsedPeriodCount: 1,
          rowCount: 4,
        },
      };
    });

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request("GSTR-1")),
    ).resolves.toMatchObject({
      status: "created",
      artifactEntryCount: 1,
      summary: { status: "included", parsedPeriodCount: 1, rowCount: 4 },
    });
  });

  it("rejects mismatched summary metadata before browser download", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/summary-invalid",
      zipEntryCount: 2,
      artifactEntryCount: 1,
      summaryEntryCount: 1,
      summary: {
        status: "included",
        workbookOutcome: "not-applicable",
        outcomeOnly: false,
        parsedPeriodCount: 2,
        rowCount: 2,
      },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toEqual({ status: "failed", errorCategory: "offscreen-response-invalid" });
  });

  it("accepts a GSTR-2B receipt that includes a workbook entry", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/wrong-form-workbook",
      zipEntryCount: 2,
      artifactEntryCount: 1,
      // One, not two: GSTR-2B ships the workbook alone now that its tidy CSV
      // carries no invoice rows.
      summaryEntryCount: 1,
      summary: {
        status: "included",
        outcomeOnly: false,
        parsedPeriodCount: 1,
        rowCount: 2,
        workbookOnly: true,
      },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toMatchObject({
      status: "created",
      artifactEntryCount: 1,
      summary: { status: "included", parsedPeriodCount: 1, rowCount: 2 },
    });
  });

  // The worker always sets `workbookOnly` for a successful GSTR-2B workbook,
  // because that run ships without the tidy CSV. A receipt missing it is a shape
  // the worker cannot emit, and accepting it let the status message claim a CSV
  // the ZIP does not contain.
  it("rejects a successful GSTR-2B workbook receipt with no workbook-only flag", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/missing-flag",
      zipEntryCount: 2,
      artifactEntryCount: 1,
      summaryEntryCount: 1,
      summary: { status: "included", outcomeOnly: false, parsedPeriodCount: 1, rowCount: 2 },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toMatchObject({ status: "failed", errorCategory: "offscreen-response-invalid" });
  });

  // A produced workbook needs a staged JSON source, and such a source also
  // contributes a parsed period. Zero parsed periods beside a produced workbook
  // is a combination the worker cannot reach.
  it("rejects a workbook receipt reporting no parsed period", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/no-parsed-period",
      zipEntryCount: 2,
      artifactEntryCount: 1,
      summaryEntryCount: 1,
      summary: {
        status: "included",
        outcomeOnly: true,
        parsedPeriodCount: 0,
        rowCount: 1,
        workbookOnly: true,
      },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toMatchObject({ status: "failed", errorCategory: "offscreen-response-invalid" });
  });

  // A GSTR-2B year whose staged JSON carries no supported `docdata` section
  // produces the tidy CSV and no workbook, and the worker says so with
  // "not-applicable". The validator used to re-derive the expected outcome from
  // the return type alone and reject this, which discarded an already
  // privacy-screened CSV and blocked the whole ZIP.
  it("accepts a GSTR-2B receipt that emitted the CSV alone for want of records", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/csv-only",
      zipEntryCount: 2,
      artifactEntryCount: 1,
      summaryEntryCount: 1,
      summary: {
        status: "included",
        outcomeOnly: false,
        parsedPeriodCount: 1,
        rowCount: 2,
        workbookOutcome: "no-records",
      },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toMatchObject({
      status: "created",
      artifactEntryCount: 1,
      summary: { status: "included", parsedPeriodCount: 1, rowCount: 2 },
    });
  });

  // A PDF-only GSTR-2B selection, or one whose JSON is artifact-unavailable,
  // never had a source to build from and reports `no-source`. What makes that
  // receipt valid is the *plan* staging no JSON, so the request has to be one
  // where none was: an earlier version of this test paired the outcome with a
  // staged-JSON request and pinned a receipt no worker can emit.
  it("accepts a GSTR-2B receipt reporting no staged source", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/gstr2b-no-source",
      zipEntryCount: 2,
      artifactEntryCount: 1,
      summaryEntryCount: 1,
      summary: {
        status: "included",
        outcomeOnly: true,
        parsedPeriodCount: 0,
        rowCount: 1,
        workbookOutcome: "no-source",
      },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", pdfOnlyRequest("GSTR-2B")),
    ).resolves.toMatchObject({ status: "created" });
  });

  // The plan is what says whether anything was staged, so that is what the
  // absence reason binds to. Checking the receipt's own count against the
  // receipt's own outcome asks the untrusted side to corroborate itself, and a
  // response wrong about one is wrong about the other in the same way -- it
  // agrees with itself perfectly and states a false reason to the user.
  it("rejects a no-source receipt when the plan staged JSON", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/gstr2b-false-absence",
      zipEntryCount: 2,
      artifactEntryCount: 1,
      summaryEntryCount: 1,
      summary: {
        status: "included",
        outcomeOnly: true,
        parsedPeriodCount: 0,
        rowCount: 1,
        workbookOutcome: "no-source",
      },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toMatchObject({ status: "failed", errorCategory: "offscreen-response-invalid" });
  });

  // The absence reasons are not interchangeable. `not-applicable` renders "not
  // available for this return type", which is false for GSTR-2B, so a stale
  // receipt carrying it must not reach the user with that sentence.
  it("rejects a GSTR-2B receipt claiming the workbook is not applicable", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/gstr2b-wrong-reason",
      zipEntryCount: 2,
      artifactEntryCount: 1,
      summaryEntryCount: 1,
      summary: {
        status: "included",
        outcomeOnly: true,
        parsedPeriodCount: 0,
        rowCount: 1,
        workbookOutcome: "not-applicable",
      },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toMatchObject({ status: "failed", errorCategory: "offscreen-response-invalid" });
  });

  // `no-source` says nothing was staged, so a receipt claiming it beside a
  // parsed period describes two producer states at once.
  it("rejects a no-source receipt that also reports a parsed period", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/gstr2b-contradictory",
      zipEntryCount: 2,
      artifactEntryCount: 1,
      summaryEntryCount: 1,
      summary: {
        status: "included",
        outcomeOnly: false,
        parsedPeriodCount: 1,
        rowCount: 2,
        workbookOutcome: "no-source",
      },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toMatchObject({ status: "failed", errorCategory: "offscreen-response-invalid" });
  });

  // A workbook without ITC totals ships beside the CSV, and that receipt omits
  // `workbookOnly` with two summary entries. Requiring the flag for every
  // successful GSTR-2B workbook made this fallback unreachable.
  it("accepts a GSTR-2B receipt carrying both the CSV and the workbook", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/csv-and-workbook",
      zipEntryCount: 3,
      artifactEntryCount: 1,
      summaryEntryCount: 2,
      summary: { status: "included", outcomeOnly: false, parsedPeriodCount: 1, rowCount: 2 },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toMatchObject({ status: "created", artifactEntryCount: 1 });
  });

  // GSTR-3B can only produce a workbook plus CSV or a failed summary. Accepting
  // the CSV-only outcomes for it would let a stale or malformed receipt through
  // as an incomplete ZIP, so eligibility alone is not the right test.
  it.each(["not-applicable", "unavailable"] as const)(
    "rejects a GSTR-3B receipt claiming the %s workbook outcome",
    async (workbookOutcome) => {
      mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
        ok: true,
        requestId: requestIdFrom(message),
        blobUrl: "blob:pack/gstr3b-csv-only",
        zipEntryCount: 2,
        artifactEntryCount: 1,
        summaryEntryCount: 1,
        summary: {
          status: "included",
          outcomeOnly: false,
          parsedPeriodCount: 1,
          rowCount: 2,
          workbookOutcome,
        },
      }));

      await expect(
        createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request("GSTR-3B")),
      ).resolves.toMatchObject({ status: "failed", errorCategory: "offscreen-response-invalid" });
    },
  );

  it.each([
    "identity-conflict",
    "identity-rejected",
    "identity-unverified",
    "privacy-rejected",
  ] as const)("preserves the fixed %s summary rejection category", async (reasonCategory) => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/rejected-summary",
      zipEntryCount: 1,
      artifactEntryCount: 1,
      summaryEntryCount: 0,
      summary: { status: "failed", reasonCategory },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toMatchObject({
      status: "created",
      summary: { status: "failed", reasonCategory },
    });
  });

  it("rejects a receipt whose offscreen artifact count does not match the request", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/artifact-count-invalid",
      zipEntryCount: 2,
      artifactEntryCount: 2,
      summaryEntryCount: 0,
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toEqual({ status: "failed" });
  });
  // Only the GSTR-2B workbook is built from staged JSON. The GSTR-3B workbook is
  // built from the run's own outcome rows, so a PDF-only selection produces one
  // with no parsed period at all -- a receipt the producer emits and its own
  // test pins, which this boundary rejected. The producer test never crosses
  // this boundary, which is why a green suite said nothing about it.
  it("accepts a GSTR-3B workbook receipt with no parsed period", async () => {
    mocks.runtime.sendMessage.mockImplementationOnce(async (message?: unknown) => ({
      ok: true,
      requestId: requestIdFrom(message),
      blobUrl: "blob:pack/gstr3b-pdf-only",
      zipEntryCount: 3,
      artifactEntryCount: 1,
      summaryEntryCount: 2,
      summary: { status: "included", outcomeOnly: true, parsedPeriodCount: 0, rowCount: 1 },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", pdfOnlyRequest("GSTR-3B")),
    ).resolves.toMatchObject({ status: "created", artifactEntryCount: 1 });
  });
});

function pdfOnlyRequest(returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B") {
  return {
    returnType,
    entryCount: 1,
    entries: [{ artifactType: "PDF" as const, entryNames: ["april-return.pdf"] }],
    generatedAt: new Date("2026-08-19T12:00:00.000Z"),
    summaryPlan: [
      {
        artifactType: "PDF" as const,
        entryNames: ["april-return.pdf"],
        financialYear: "2026-27",
        outcomeCategory: "staged" as const,
        period: "April" as const,
        returnType,
      },
    ],
  };
}

function request(returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B" = "GSTR-2B") {
  return {
    returnType,
    entryCount: 1,
    entries: [{ artifactType: "JSON" as const, entryNames: ["april-data.json"] }],
    generatedAt: new Date("2026-08-19T12:00:00.000Z"),
    summaryPlan: [
      {
        artifactType: "JSON" as const,
        entryNames: ["april-data.json"],
        financialYear: "2026-27",
        outcomeCategory: "staged" as const,
        period: "April" as const,
        returnType,
      },
    ],
  };
}

function requestIdFrom(message: unknown): string {
  if (!message || typeof message !== "object" || !("payload" in message)) return "invalid";
  const payload = message.payload;
  if (!payload || typeof payload !== "object" || !("requestId" in payload)) return "invalid";
  return String(payload.requestId);
}

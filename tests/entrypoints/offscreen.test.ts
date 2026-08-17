import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPackOffscreenBlobUrlMessage } from "../../src/connectors/gst/filed-returns-offscreen-validation";
import { PACK_OFFSCREEN_BLOB_URL_TARGET } from "../../src/connectors/gst/offscreen-blob-url";
import { createPortalGstr2bWorkbook } from "../fixtures/gstr2b-workbook";

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

const TEST_LEDGER_ID = "11111111111111111111";
const TEST_FULL_YEAR_LEDGER_ID = "22222222222222222222";
const TEST_MISSING_LEDGER_ID = "33333333333333333333";
const TEST_RUNTIME_ID = "pack-extension-test";

describe("offscreen Blob URL entrypoint", () => {
  let listener: RuntimeListener | null;
  let blobCounter: number;
  let discardExcelWrites: boolean;
  const revokedBlobUrls: string[] = [];
  const createdBlobs: Blob[] = [];
  const opfsFiles = new Map<string, Blob>();

  beforeEach(() => {
    vi.doUnmock("../../src/connectors/gst/filed-returns-summary-sheet");
    vi.resetModules();
    listener = null;
    blobCounter = 0;
    discardExcelWrites = false;
    revokedBlobUrls.length = 0;
    createdBlobs.length = 0;
    opfsFiles.clear();
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (blob instanceof Blob) createdBlobs.push(blob);
      blobCounter += 1;
      return `blob:pack-test/${blobCounter}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((blobUrl: string) => {
      revokedBlobUrls.push(blobUrl);
    });
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: vi.fn(async () => directoryHandle("")),
      },
    });
  });

  it("validates the clear-ledger message shape", () => {
    expect(
      isPackOffscreenBlobUrlMessage({
        type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: "clear-request",
          ledgerId: TEST_LEDGER_ID,
        },
      }),
    ).toBe(true);
    expect(
      isPackOffscreenBlobUrlMessage({
        type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: "short",
          ledgerId: TEST_LEDGER_ID,
        },
      }),
    ).toBe(false);
  });

  it("validates the explicit clear-all-ledgers message shape", () => {
    expect(
      isPackOffscreenBlobUrlMessage({
        type: "PACK_OFFSCREEN_CLEAR_ALL_FILED_RETURN_LEDGERS",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: { requestId: "clear-all-request" },
      }),
    ).toBe(true);
    expect(
      isPackOffscreenBlobUrlMessage({
        type: "PACK_OFFSCREEN_CLEAR_ALL_FILED_RETURN_LEDGERS",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: { requestId: "clear-all-request", ledgerId: "unexpected" },
      }),
    ).toBe(false);
  });

  it("treats an already-absent staged ledger as cleared", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: vi.fn(async () => ({
          async getDirectoryHandle() {
            throw { name: "NotFoundError" };
          },
        })),
      },
    });
    await loadOffscreenEntrypoint();

    const response = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "clear-missing-request",
        ledgerId: TEST_MISSING_LEDGER_ID,
      },
    });

    expect(response).toEqual({
      ok: true,
      requestId: "clear-missing-request",
      cleared: true,
    });
  });

  it("requires return and artifact metadata for filed-return staging messages", () => {
    const validMessage = {
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "stage-request",
        ledgerId: TEST_LEDGER_ID,
        zipPath: "may.xlsx",
        returnType: "GSTR-2B",
        artifactType: "EXCEL",
        dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 staged")}`,
      },
    };
    expect(isPackOffscreenBlobUrlMessage(validMessage)).toBe(true);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          artifactType: "PDF",
          returnType: "GSTR-3B",
          zipPath: "april-return.pdf",
        },
      }),
    ).toBe(true);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          artifactType: "PDF",
          returnType: "GSTR-3B",
          zipPath: "april-return.xlsx",
        },
      }),
    ).toBe(false);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          artifactType: "PDF",
          returnType: "GSTR-2B",
          zipPath: "april-return.pdf",
        },
      }),
    ).toBe(false);
    expect(
      isPackOffscreenBlobUrlMessage({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: "stage-request",
          ledgerId: TEST_LEDGER_ID,
          zipPath: "may.xlsx",
          dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 staged")}`,
        },
      }),
    ).toBe(false);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...validMessage,
        payload: { ...validMessage.payload, ledgerId: "synthetic-taxpayer-name" },
      }),
    ).toBe(false);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...validMessage,
        payload: { ...validMessage.payload, zipPath: "synthetic-taxpayer-name.xlsx" },
      }),
    ).toBe(false);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...validMessage,
        payload: { ...validMessage.payload, unexpectedText: "synthetic-taxpayer-name" },
      }),
    ).toBe(false);
  });

  it("rejects offscreen messages from tab and non-extension senders", async () => {
    await loadOffscreenEntrypoint();
    const message = {
      type: "PACK_OFFSCREEN_CLEAR_ALL_FILED_RETURN_LEDGERS",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: { requestId: "clear-all-request" },
    };

    expect(listener?.(message, { id: TEST_RUNTIME_ID, tab: { id: 1 } }, vi.fn())).toBe(false);
    expect(listener?.(message, { id: "other-extension" }, vi.fn())).toBe(false);
  });

  it("accepts repeated artifact slots but rejects duplicate names or type-inconsistent plans", () => {
    const baseMessage = {
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "exact-plan-request",
        ledgerId: TEST_LEDGER_ID,
        expectedReturnType: "GSTR-1",
        expectedEntryCount: 2,
      },
    } as const;
    expect(
      isPackOffscreenBlobUrlMessage({
        ...baseMessage,
        payload: {
          ...baseMessage.payload,
          expectedEntries: [
            { artifactType: "PDF", entryNames: ["may.pdf"] },
            { artifactType: "PDF", entryNames: ["june.pdf"] },
          ],
        },
      }),
    ).toBe(true);
    const summaryMessage = {
      ...baseMessage,
      payload: {
        ...baseMessage.payload,
        expectedEntries: [
          { artifactType: "PDF", entryNames: ["may.pdf"] },
          { artifactType: "PDF", entryNames: ["june.pdf"] },
        ],
        summaryPlan: [
          {
            artifactType: "PDF",
            entryNames: ["may.pdf"],
            outcomeCategory: "staged",
            period: "May",
            returnType: "GSTR-1",
          },
          {
            artifactType: "PDF",
            entryNames: ["june.pdf"],
            outcomeCategory: "staged",
            period: "June",
            returnType: "GSTR-1",
          },
        ],
      },
    };
    expect(isPackOffscreenBlobUrlMessage(summaryMessage)).toBe(true);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...summaryMessage,
        payload: {
          ...summaryMessage.payload,
          summaryPlan: [
            { ...summaryMessage.payload.summaryPlan[0], entryNames: ["june.pdf"] },
            { ...summaryMessage.payload.summaryPlan[1], entryNames: ["may.pdf"] },
          ],
        },
      }),
    ).toBe(false);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...summaryMessage,
        payload: {
          ...summaryMessage.payload,
          summaryPlan: [
            ...summaryMessage.payload.summaryPlan.slice(0, 1),
            { ...summaryMessage.payload.summaryPlan[1], period: "FULL_FISCAL_YEAR" },
          ],
        },
      }),
    ).toBe(false);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...summaryMessage,
        payload: {
          ...summaryMessage.payload,
          summaryPlan: summaryMessage.payload.summaryPlan.map((entry) => ({
            ...entry,
            outcomeCategory: "not-filed",
          })),
        },
      }),
    ).toBe(false);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...baseMessage,
        payload: {
          ...baseMessage.payload,
          expectedEntries: [
            { artifactType: "PDF", entryNames: ["may.pdf"] },
            { artifactType: "PDF", entryNames: ["may.pdf"] },
          ],
        },
      }),
    ).toBe(false);
    expect(
      isPackOffscreenBlobUrlMessage({
        ...baseMessage,
        payload: {
          ...baseMessage.payload,
          expectedEntries: [
            { artifactType: "EXCEL", entryNames: ["may.pdf"] },
            { artifactType: "PDF", entryNames: ["may.xlsx"] },
          ],
        },
      }),
    ).toBe(false);
  });

  it("creates, replaces, and revokes Blob URLs by URL value", async () => {
    await loadOffscreenEntrypoint();

    const firstCreate = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "request-1",
        dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`,
      },
    });
    expect(firstCreate).toEqual({
      ok: true,
      requestId: "request-1",
      blobUrl: "blob:pack-test/1",
    });

    const secondCreate = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "request-1",
        dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 replacement")}`,
      },
    });
    expect(secondCreate).toEqual({
      ok: true,
      requestId: "request-1",
      blobUrl: "blob:pack-test/2",
    });
    expect(revokedBlobUrls).toEqual(["blob:pack-test/1"]);

    const revoke = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_REVOKE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "revoke-request",
        blobUrl: "blob:pack-test/2",
      },
    });
    expect(revoke).toEqual({
      ok: true,
      requestId: "revoke-request",
      revoked: true,
    });
    expect(revokedBlobUrls).toEqual(["blob:pack-test/1", "blob:pack-test/2"]);
  });

  it("rejects invalid data URLs without creating Blob URLs", async () => {
    await loadOffscreenEntrypoint();

    const response = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "bad-data-url",
        dataUrl: "https://example.invalid/not-a-data-url",
      },
    });

    expect(response).toEqual({
      ok: false,
      requestId: "bad-data-url",
      errorCategory: "invalid-data-url",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("stages filed-return bytes and creates a local zip Blob URL", async () => {
    await loadOffscreenEntrypoint();

    const stage = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "stage-request",
        ledgerId: TEST_LEDGER_ID,
        zipPath: "may-return.pdf",
        returnType: "GSTR-3B",
        artifactType: "PDF",
        dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 staged\n%%EOF\n")}`,
      },
    });

    expect(stage).toEqual({
      ok: true,
      requestId: "stage-request",
      staged: true,
      byteCountClass: "non-empty",
      byteCount: "%PDF-1.7 staged\n%%EOF\n".length,
      artifactType: "PDF",
      ledgerId: TEST_LEDGER_ID,
      returnType: "GSTR-3B",
      zipPath: "may-return.pdf",
    });
    expect(opfsFiles.has(`filed-return-packs/${TEST_LEDGER_ID}/may-return.pdf`)).toBe(true);

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "zip-request",
        ledgerId: TEST_LEDGER_ID,
        expectedReturnType: "GSTR-3B",
        expectedEntryCount: 1,
        expectedEntries: [{ artifactType: "PDF", entryNames: ["may-return.pdf"] }],
      },
    });

    expect(zip).toEqual({
      ok: true,
      requestId: "zip-request",
      blobUrl: "blob:pack-test/1",
      zipEntryCount: 1,
      artifactEntryCount: 1,
      summaryEntryCount: 0,
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/zip" }),
    );

    const clear = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "clear-request",
        ledgerId: TEST_LEDGER_ID,
      },
    });

    expect(clear).toEqual({
      ok: true,
      requestId: "clear-request",
      cleared: true,
    });
    expect(opfsFiles.has(`filed-return-packs/${TEST_LEDGER_ID}/may-return.pdf`)).toBe(false);
  });

  it("stages the generated GSTR-2B JSON ZIP entry name without re-encoding its bytes", async () => {
    await loadOffscreenEntrypoint();
    const json = JSON.stringify({ synthetic: true, period: "May" });
    const staged = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "stage-json-request",
        ledgerId: TEST_LEDGER_ID,
        zipPath: "may-data.json",
        returnType: "GSTR-2B",
        artifactType: "JSON",
        dataUrl: `data:application/json;base64,${btoa(json)}`,
      },
    });

    expect(staged).toMatchObject({ ok: true, staged: true });
    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "zip-json-request",
        ledgerId: TEST_LEDGER_ID,
        expectedReturnType: "GSTR-2B",
        expectedEntryCount: 1,
        expectedEntries: [{ artifactType: "JSON", entryNames: ["may-data.json"] }],
      },
    });

    expect(zip).toMatchObject({ ok: true, zipEntryCount: 1 });
  });

  it("adds a deterministic portal-key summary to the existing full-year archive", async () => {
    await loadOffscreenEntrypoint();
    const portalRows = [
      {
        period: "April" as const,
        path: "april-data.json",
        value: {
          status: 1,
          data: {
            rtnprd: "042026",
            surrounding_decoy: { z: "april", a: 10 },
            entries: [{ value: 900 }],
            portal_leaf: 11,
          },
          chksum: "synthetic-april-checksum",
        },
      },
      {
        period: "May" as const,
        path: "may-data.json",
        value: {
          status: 1,
          data: {
            rtnprd: "052026",
            surrounding_decoy: { z: "may" },
            entries: [{ value: 800 }, { value: 700 }],
            other_portal_leaf: 22,
          },
          chksum: "synthetic-may-checksum",
        },
      },
    ];
    for (const row of portalRows) {
      const staged = await sendOffscreenMessage({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: `stage-${row.period.toLowerCase()}-json`,
          ledgerId: TEST_FULL_YEAR_LEDGER_ID,
          zipPath: row.path,
          returnType: "GSTR-2B",
          artifactType: "JSON",
          dataUrl: `data:application/json;base64,${btoa(JSON.stringify(row.value))}`,
        },
      });
      expect(staged).toMatchObject({ ok: true, staged: true });
    }

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "full-year-summary-request",
        ledgerId: TEST_FULL_YEAR_LEDGER_ID,
        expectedReturnType: "GSTR-2B",
        expectedEntryCount: 2,
        expectedEntries: portalRows.map((row) => ({
          artifactType: "JSON",
          entryNames: [row.path],
        })),
        summaryPlan: portalRows.map((row) => ({
          artifactType: "JSON",
          entryNames: [row.path],
          outcomeCategory: "staged",
          period: row.period,
          returnType: "GSTR-2B",
        })),
      },
    });

    expect(zip).toEqual({
      ok: true,
      requestId: "full-year-summary-request",
      blobUrl: "blob:pack-test/1",
      zipEntryCount: 3,
      artifactEntryCount: 2,
      summaryEntryCount: 1,
      summary: {
        status: "included",
        outcomeOnly: false,
        parsedPeriodCount: 2,
        rowCount: 2,
      },
    });
    const entries = await extractStoredZipEntries(createdBlobs[0]!);
    expect([...entries.keys()]).toEqual([
      "april-data.json",
      "may-data.json",
      "full-year-summary.csv",
    ]);
    const summary = new TextDecoder().decode(entries.get("full-year-summary.csv"));
    expect(summary).toContain(
      "json:/data/entries,json:/data/other_portal_leaf,json:/data/portal_leaf,json:/data/rtnprd",
    );
    expect(summary).toContain("April,GSTR-2B,JSON,parseable-json");
    expect(summary).toContain("May,GSTR-2B,JSON,parseable-json");
    expect(summary).not.toContain("900");
    expect(summary).not.toContain("800");
    expect(summary).not.toContain("700");
  });

  it("adds only fixed outcome rows when a full-year run has no parseable JSON", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/april-return.pdf`,
      new Blob(["%PDF-1.7 April\n%%EOF\n"]),
    );

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "pdf-only-summary-request",
        ledgerId: TEST_FULL_YEAR_LEDGER_ID,
        expectedReturnType: "GSTR-3B",
        expectedEntryCount: 1,
        expectedEntries: [{ artifactType: "PDF", entryNames: ["april-return.pdf"] }],
        summaryPlan: [
          {
            artifactType: "PDF",
            entryNames: ["april-return.pdf"],
            outcomeCategory: "staged",
            period: "April",
            returnType: "GSTR-3B",
          },
        ],
      },
    });

    expect(zip).toMatchObject({
      ok: true,
      zipEntryCount: 2,
      summary: { status: "included", outcomeOnly: true, parsedPeriodCount: 0, rowCount: 1 },
    });
    const entries = await extractStoredZipEntries(createdBlobs[0]!);
    expect(new TextDecoder().decode(entries.get("full-year-summary.csv"))).toContain(
      "April,GSTR-3B,PDF,non-json-artifact",
    );
  });

  it("keeps the artifact ZIP when summary generation throws", async () => {
    vi.doMock("../../src/connectors/gst/filed-returns-summary-sheet", () => ({
      FILED_RETURNS_SUMMARY_SHEET_PATH: "full-year-summary.csv",
      buildFiledReturnsSummarySheet: () => {
        throw new Error("synthetic taxpayer figure must not escape");
      },
    }));
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/april-return.pdf`,
      new Blob(["%PDF-1.7 April\n%%EOF\n"]),
    );

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "throwing-summary-request",
        ledgerId: TEST_FULL_YEAR_LEDGER_ID,
        expectedReturnType: "GSTR-3B",
        expectedEntryCount: 1,
        expectedEntries: [{ artifactType: "PDF", entryNames: ["april-return.pdf"] }],
        summaryPlan: [
          {
            artifactType: "PDF",
            entryNames: ["april-return.pdf"],
            outcomeCategory: "staged",
            period: "April",
            returnType: "GSTR-3B",
          },
        ],
      },
    });

    expect(zip).toMatchObject({
      ok: true,
      zipEntryCount: 1,
      summary: { status: "failed", reasonCategory: "generation-failed" },
    });
    const entries = await extractStoredZipEntries(createdBlobs[0]!);
    expect([...entries.keys()]).toEqual(["april-return.pdf"]);
    expect(JSON.stringify(zip)).not.toContain("synthetic taxpayer figure");
  });

  it("keeps the artifact ZIP when the derived summary exceeds its local limit", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/april-data.json`,
      new Blob([JSON.stringify({ portal_leaf: "x".repeat(5 * 1024 * 1024) })]),
    );

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "oversized-summary-request",
        ledgerId: TEST_FULL_YEAR_LEDGER_ID,
        expectedReturnType: "GSTR-2B",
        expectedEntryCount: 1,
        expectedEntries: [{ artifactType: "JSON", entryNames: ["april-data.json"] }],
        summaryPlan: [
          {
            artifactType: "JSON",
            entryNames: ["april-data.json"],
            outcomeCategory: "staged",
            period: "April",
            returnType: "GSTR-2B",
          },
        ],
      },
    });

    expect(zip).toMatchObject({
      ok: true,
      zipEntryCount: 1,
      summary: { status: "failed", reasonCategory: "too-large" },
    });
    const entries = await extractStoredZipEntries(createdBlobs[0]!);
    expect([...entries.keys()]).toEqual(["april-data.json"]);
  });

  it("rejects a stage receipt when the exact Excel slot does not survive its write", async () => {
    discardExcelWrites = true;
    await loadOffscreenEntrypoint();

    const response = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "discarded-excel-request",
        ledgerId: TEST_FULL_YEAR_LEDGER_ID,
        zipPath: "april-details.xlsx",
        returnType: "GSTR-1",
        artifactType: "EXCEL",
        dataUrl: xlsxDataUrl(createPortalGstr2bWorkbook()),
      },
    });

    expect(response).toEqual({
      ok: false,
      requestId: "discarded-excel-request",
      errorCategory: "stage-failed",
    });
  });

  it("retains every GSTR-1 full-year PDF and Excel slot before ZIP construction", async () => {
    await loadOffscreenEntrypoint();
    const periods = [
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
      "january",
      "february",
      "march",
    ];
    const workbook = xlsxDataUrl(createPortalGstr2bWorkbook());
    for (const period of periods) {
      const pdf = await sendOffscreenMessage({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: `${period}-pdf-request`,
          ledgerId: TEST_FULL_YEAR_LEDGER_ID,
          zipPath: `${period}-summary.pdf`,
          returnType: "GSTR-1",
          artifactType: "PDF",
          dataUrl: `data:application/pdf;base64,${btoa(`%PDF-1.7 ${period}\n%%EOF\n`)}`,
        },
      });
      const excel = await sendOffscreenMessage({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: `${period}-excel-request`,
          ledgerId: TEST_FULL_YEAR_LEDGER_ID,
          zipPath: `${period}-details.xlsx`,
          returnType: "GSTR-1",
          artifactType: "EXCEL",
          dataUrl: workbook,
        },
      });
      expect(pdf).toMatchObject({ ok: true, staged: true, artifactType: "PDF" });
      expect(excel).toMatchObject({ ok: true, staged: true, artifactType: "EXCEL" });
    }

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "gstr1-full-year-request",
        ledgerId: TEST_FULL_YEAR_LEDGER_ID,
        expectedReturnType: "GSTR-1",
        expectedEntryCount: periods.length * 2,
        expectedEntries: periods.flatMap((period) => [
          { artifactType: "PDF" as const, entryNames: [`${period}-summary.pdf`] },
          { artifactType: "EXCEL" as const, entryNames: [`${period}-details.xlsx`] },
        ]),
      },
    });

    expect(zip).toMatchObject({ ok: true, zipEntryCount: periods.length * 2 });
  });

  it("rejects a staged ZIP input larger than 100 MB before creating a Blob URL", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/may.pdf`,
      new Blob(["%PDF-1.7 oversized\n", new Uint8Array(100 * 1024 * 1024), "\n%%EOF\n"]),
    );

    const response = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "oversized-zip-request",
        ledgerId: TEST_LEDGER_ID,
        expectedReturnType: "GSTR-3B",
        expectedEntryCount: 1,
        expectedEntries: [{ artifactType: "PDF", entryNames: ["may.pdf"] }],
      },
    });

    expect(response).toEqual({
      ok: false,
      requestId: "oversized-zip-request",
      errorCategory: "zip-too-large",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("clears every Pack filed-return staging directory on explicit reset", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(`filed-return-packs/${TEST_LEDGER_ID}/april.pdf`, new Blob(["one"]));
    opfsFiles.set(`filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/may.pdf`, new Blob(["two"]));

    const response = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CLEAR_ALL_FILED_RETURN_LEDGERS",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: { requestId: "clear-all-request" },
    });

    expect(response).toEqual({
      ok: true,
      requestId: "clear-all-request",
      cleared: true,
    });
    expect([...opfsFiles.keys()]).toEqual([]);
  });

  it("rejects non-chunked GSTR-2B bytes that do not match the requested artifact", async () => {
    await loadOffscreenEntrypoint();

    const rejected = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "bad-stage-request",
        ledgerId: TEST_LEDGER_ID,
        zipPath: "may.xlsx",
        returnType: "GSTR-2B",
        artifactType: "EXCEL",
        dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa(
          "PK\u0003\u0004not-a-portal-gstr2b-workbook",
        )}`,
      },
    });

    expect(rejected).toEqual({
      ok: false,
      requestId: "bad-stage-request",
      errorCategory: "invalid-data-url",
    });
    expect(opfsFiles.has(`filed-return-packs/${TEST_LEDGER_ID}/may.xlsx`)).toBe(false);
  });

  it("rejects stale staged GSTR-2B placeholder PDFs before creating the final zip", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/may.pdf`,
      new Blob(["%PDF-1.4\nBT (ComplyEaze Pack generated GSTR-2B summary) Tj ET\n%%EOF\n"]),
    );
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/may.xlsx`,
      new Blob([toArrayBuffer(createPortalGstr2bWorkbook())]),
    );

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "zip-request",
        ledgerId: TEST_LEDGER_ID,
        expectedReturnType: "GSTR-2B",
        expectedEntryCount: 2,
        expectedEntries: [
          { artifactType: "PDF", entryNames: ["may.pdf"] },
          { artifactType: "EXCEL", entryNames: ["may.xls", "may.xlsx"] },
        ],
      },
    });

    expect(zip).toEqual({
      ok: false,
      requestId: "zip-request",
      errorCategory: "zip-invalid-entry",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("creates a ZIP only when its exact PDF and Excel entry plan matches", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/may.pdf`,
      new Blob(["%PDF-1.7 exact PDF\n%%EOF\n"]),
    );
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/may.xls`,
      new Blob([toArrayBuffer(syntheticXlsBytes())]),
    );

    const response = await sendExactCombinedZipRequest(TEST_LEDGER_ID);

    expect(response).toEqual({
      ok: true,
      requestId: "exact-combined-request",
      blobUrl: "blob:pack-test/1",
      zipEntryCount: 2,
      artifactEntryCount: 2,
      summaryEntryCount: 0,
    });
  });

  it("creates the GSTR-2B all-formats ZIP from the canonical staged entry names", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/april-summary.pdf`,
      new Blob([`%PDF-1.7 portal summary\n${"0".repeat(20 * 1024)}\n%%EOF\n`]),
    );
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/april-details.xlsx`,
      new Blob([toArrayBuffer(createPortalGstr2bWorkbook())]),
    );
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/april-data.json`,
      new Blob([JSON.stringify({ synthetic: true, period: "April" })]),
    );

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "gstr2b-all-formats-request",
        ledgerId: TEST_LEDGER_ID,
        expectedReturnType: "GSTR-2B",
        expectedEntryCount: 3,
        expectedEntries: [
          { artifactType: "PDF", entryNames: ["april-summary.pdf"] },
          { artifactType: "EXCEL", entryNames: ["april-details.xls", "april-details.xlsx"] },
          { artifactType: "JSON", entryNames: ["april-data.json"] },
        ],
      },
    });

    expect(zip).toMatchObject({ ok: true, zipEntryCount: 3 });
  });

  it.each([
    ["missing PDF", ["may.xls"]],
    ["missing Excel", ["may.pdf"]],
    ["an extra entry", ["may.pdf", "may.xls", "june.pdf"]],
    ["a duplicate artifact", ["may.pdf", "may-copy.pdf"]],
    ["both Excel extension variants", ["may.xls", "may.xlsx"]],
  ])("rejects an exact combined ZIP with %s", async (_label, paths) => {
    await loadOffscreenEntrypoint();
    for (const path of paths) {
      opfsFiles.set(
        `filed-return-packs/${TEST_LEDGER_ID}/${path}`,
        path.endsWith(".xls") || path.endsWith(".xlsx")
          ? new Blob([toArrayBuffer(syntheticXlsBytes())])
          : new Blob(["%PDF-1.7 exact PDF\n%%EOF\n"]),
      );
    }

    const response = await sendExactCombinedZipRequest(TEST_LEDGER_ID);

    expect(response).toEqual({
      ok: false,
      requestId: "exact-combined-request",
      errorCategory: "zip-invalid-entry",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects type-swapped bytes under the exact PDF and Excel paths", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/may.pdf`,
      new Blob([toArrayBuffer(syntheticXlsBytes())]),
    );
    opfsFiles.set(
      `filed-return-packs/${TEST_LEDGER_ID}/may.xls`,
      new Blob(["%PDF-1.7 wrong type\n%%EOF\n"]),
    );

    const response = await sendExactCombinedZipRequest(TEST_LEDGER_ID);

    expect(response).toEqual({
      ok: false,
      requestId: "exact-combined-request",
      errorCategory: "zip-invalid-entry",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("creates a full-year ZIP only for the exact canonical ordered period slots", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/may.pdf`,
      new Blob(["%PDF-1.7 May\n%%EOF\n"]),
    );
    opfsFiles.set(
      `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/april.pdf`,
      new Blob(["%PDF-1.7 April\n%%EOF\n"]),
    );

    const response = await sendExactFullYearZipRequest();

    expect(response).toEqual({
      ok: true,
      requestId: "exact-full-year-request",
      blobUrl: "blob:pack-test/1",
      zipEntryCount: 2,
      artifactEntryCount: 2,
      summaryEntryCount: 0,
    });
  });

  it.each([
    ["a missing period", ["april.pdf"]],
    ["an extra period", ["april.pdf", "may.pdf", "june.pdf"]],
    ["a wrong period", ["april.pdf", "june.pdf"]],
    ["a duplicate target artifact", ["april.pdf", "april-copy.pdf"]],
  ])("rejects a full-year ZIP with %s", async (_label, paths) => {
    await loadOffscreenEntrypoint();
    for (const path of paths) {
      opfsFiles.set(
        `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/${path}`,
        new Blob([`%PDF-1.7 ${path}\n%%EOF\n`]),
      );
    }

    const response = await sendExactFullYearZipRequest();

    expect(response).toEqual({
      ok: false,
      requestId: "exact-full-year-request",
      errorCategory: "zip-invalid-entry",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("accepts a reordered target plan for the exact same staged artifact set", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/april.pdf`,
      new Blob(["%PDF-1.7 April\n%%EOF\n"]),
    );
    opfsFiles.set(
      `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/may.pdf`,
      new Blob(["%PDF-1.7 May\n%%EOF\n"]),
    );

    // Plan slot order is the caller's acquisition order and never reaches the ZIP, whose entry
    // order is the canonical staged order. Only the exact artifact set is load-bearing here; the
    // rejection cases above still cover a missing, extra, wrong, or duplicated target.
    const response = await sendExactFullYearZipRequest([
      { artifactType: "PDF", entryNames: ["may.pdf"] },
      { artifactType: "PDF", entryNames: ["april.pdf"] },
    ]);

    expect(response).toEqual({
      ok: true,
      requestId: "exact-full-year-request",
      blobUrl: "blob:pack-test/1",
      zipEntryCount: 2,
      artifactEntryCount: 2,
      summaryEntryCount: 0,
    });
  });

  it("rejects type-swapped bytes in a full-year target slot", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/april.pdf`,
      new Blob([toArrayBuffer(syntheticXlsBytes())]),
    );
    opfsFiles.set(
      `filed-return-packs/${TEST_FULL_YEAR_LEDGER_ID}/may.pdf`,
      new Blob(["%PDF-1.7 May\n%%EOF\n"]),
    );

    const response = await sendExactFullYearZipRequest();

    expect(response).toEqual({
      ok: false,
      requestId: "exact-full-year-request",
      errorCategory: "zip-invalid-entry",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  function sendExactCombinedZipRequest(ledgerId: string): Promise<unknown> {
    return sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "exact-combined-request",
        ledgerId,
        expectedReturnType: "GSTR-1",
        expectedEntryCount: 2,
        expectedEntries: [
          { artifactType: "PDF", entryNames: ["may.pdf"] },
          { artifactType: "EXCEL", entryNames: ["may.xls", "may.xlsx"] },
        ],
      },
    });
  }

  function sendExactFullYearZipRequest(
    expectedEntries = [
      { artifactType: "PDF" as const, entryNames: ["april.pdf"] },
      { artifactType: "PDF" as const, entryNames: ["may.pdf"] },
    ],
  ): Promise<unknown> {
    return sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "exact-full-year-request",
        ledgerId: TEST_FULL_YEAR_LEDGER_ID,
        expectedReturnType: "GSTR-3B",
        expectedEntryCount: 2,
        expectedEntries,
      },
    });
  }

  function syntheticXlsBytes(): Uint8Array {
    return new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
  }

  function xlsxDataUrl(bytes: Uint8Array): string {
    return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa(
      String.fromCharCode(...bytes),
    )}`;
  }

  async function loadOffscreenEntrypoint() {
    vi.doMock("wxt/browser", () => ({
      browser: {
        runtime: {
          id: TEST_RUNTIME_ID,
          onMessage: {
            addListener: vi.fn((registeredListener: RuntimeListener) => {
              listener = registeredListener;
            }),
          },
        },
      },
    }));
    await import("../../src/entrypoints/offscreen/main");
    expect(listener).toBeTypeOf("function");
  }

  async function sendOffscreenMessage(message: unknown): Promise<unknown> {
    if (!listener) throw new Error("Offscreen listener was not registered.");
    return new Promise((resolve) => {
      const handled = listener?.(message, { id: TEST_RUNTIME_ID }, resolve);
      expect(handled).toBe(true);
    });
  }

  function directoryHandle(prefix: string): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: prefix.split("/").filter(Boolean).at(-1) ?? "",
      async getDirectoryHandle(name: string) {
        return directoryHandle(joinPath(prefix, name));
      },
      async getFileHandle(name: string) {
        const path = joinPath(prefix, name);
        return {
          kind: "file",
          name,
          async createWritable() {
            return {
              async write(data: Blob) {
                if (discardExcelWrites && path.endsWith(".xlsx")) return;
                opfsFiles.set(path, data);
              },
              async close() {
                return undefined;
              },
            } as unknown as FileSystemWritableFileStream;
          },
          async getFile() {
            return opfsFiles.get(path) ?? new Blob();
          },
        } as unknown as FileSystemFileHandle;
      },
      async removeEntry(name: string, options?: { recursive?: boolean }) {
        const path = joinPath(prefix, name);
        const prefixWithSlash = `${path}/`;
        if (options?.recursive) {
          for (const filePath of [...opfsFiles.keys()]) {
            if (filePath === path || filePath.startsWith(prefixWithSlash)) {
              opfsFiles.delete(filePath);
            }
          }
          return undefined;
        }
        opfsFiles.delete(path);
        return undefined;
      },
      async *entries() {
        const children = directChildren(prefix);
        for (const [name, kind] of children) {
          yield [
            name,
            kind === "directory"
              ? directoryHandle(joinPath(prefix, name))
              : ({
                  kind: "file",
                  name,
                  async getFile() {
                    return opfsFiles.get(joinPath(prefix, name)) ?? new Blob();
                  },
                } as unknown as FileSystemFileHandle),
          ] as [string, FileSystemHandle];
        }
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  async function extractStoredZipEntries(blob: Blob): Promise<Map<string, Uint8Array>> {
    const zipBytes = new Uint8Array(await blob.arrayBuffer());
    const entries = new Map<string, Uint8Array>();
    const decoder = new TextDecoder();
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    let offset = 0;
    while (offset + 30 <= zipBytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
      const compressedSize = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      const name = decoder.decode(zipBytes.slice(nameStart, nameStart + nameLength));
      entries.set(name, zipBytes.slice(dataStart, dataEnd));
      offset = dataEnd;
    }
    return entries;
  }

  function directChildren(prefix: string): Map<string, "directory" | "file"> {
    const children = new Map<string, "directory" | "file">();
    const prefixWithSlash = prefix ? `${prefix}/` : "";
    for (const path of opfsFiles.keys()) {
      if (!path.startsWith(prefixWithSlash)) continue;
      const rest = path.slice(prefixWithSlash.length);
      const [first, ...remaining] = rest.split("/");
      if (!first) continue;
      children.set(first, remaining.length > 0 ? "directory" : "file");
    }
    return children;
  }

  function joinPath(prefix: string, name: string): string {
    return prefix ? `${prefix}/${name}` : name;
  }

  function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }
});

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
      zipEntryCount: 3,
      artifactEntryCount: 1,
      summaryEntryCount: 2,
      summary: {
        status: "included",
        outcomeOnly: false,
        parsedPeriodCount: 1,
        rowCount: 2,
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
});

function request(returnType: "GSTR-1" | "GSTR-2B" = "GSTR-2B") {
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

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
        zipEntryCount: 3,
        artifactEntryCount: 1,
        summaryEntryCount: 2,
        summary: {
          status: "included",
          outcomeOnly: false,
          parsedPeriodCount: 1,
          rowCount: 4,
        },
      };
    });

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
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
      zipEntryCount: 3,
      artifactEntryCount: 1,
      summaryEntryCount: 2,
      summary: {
        status: "included",
        outcomeOnly: false,
        parsedPeriodCount: 2,
        rowCount: 2,
      },
    }));

    await expect(
      createOffscreenFiledReturnZipUrl("full-fiscal-year-12345678", request()),
    ).resolves.toEqual({ status: "failed", errorCategory: "offscreen-response-invalid" });
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

function request() {
  return {
    returnType: "GSTR-2B" as const,
    entryCount: 1,
    entries: [{ artifactType: "JSON" as const, entryNames: ["april-data.json"] }],
    summaryPlan: [
      {
        artifactType: "JSON" as const,
        entryNames: ["april-data.json"],
        financialYear: "2026-27",
        outcomeCategory: "staged" as const,
        period: "April" as const,
        returnType: "GSTR-2B" as const,
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

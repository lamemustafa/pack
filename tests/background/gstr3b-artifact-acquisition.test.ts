import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ArtifactDownloadModule from "../../src/background/artifact-download";
const mocks = vi.hoisted(() => ({
  executeScript: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  downloadAcquiredArtifact: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: {
    scripting: { executeScript: mocks.executeScript },
    downloads: {
      onCreated: { addListener: mocks.addListener, removeListener: mocks.removeListener },
    },
  },
}));
vi.mock("../../src/background/artifact-download", async (importOriginal) => ({
  ...(await importOriginal<typeof ArtifactDownloadModule>()),
  downloadAcquiredArtifact: mocks.downloadAcquiredArtifact,
}));

import {
  acquireGstr3bPdfAfterPreflight,
  GSTR3B_FIRST_CAPTURE_WAIT_MS,
  GSTR3B_RECLICK_CAPTURE_WAIT_MS,
} from "../../src/background/gstr3b-artifact-acquisition";
import { acquirePageGeneratedArtifact } from "../../src/background/gstr2b-artifact-acquisition";
import {
  GSTR1_EXCEL_NO_DETAILS_DIALOG_SELECTOR,
  GSTR1_EXCEL_NO_DETAILS_TEXT_PATTERNS,
} from "../../src/connectors/gst/gstr1-excel-no-details-text";

describe("GSTR-3B page-generated acquisition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("injects the bounded shim, validates portal bytes, then delivers one owned download", async () => {
    const bytes = new Uint8Array(1024);
    bytes.set(new TextEncoder().encode("%PDF-1.7"));
    mocks.executeScript.mockResolvedValue([
      {
        result: {
          ok: true,
          base64: Buffer.from(bytes).toString("base64"),
          blobUrl: "blob:synthetic/gstr3b",
          safeSignals: ["filed-gstr3b-portal-blob-download-captured"],
        },
      },
    ]);
    mocks.downloadAcquiredArtifact.mockResolvedValue({
      ok: true,
      downloadId: 9,
      bytesReceived: 1024,
      safeSignals: [],
    });
    await expect(
      acquireGstr3bPdfAfterPreflight({
        financialYear: "2024-25",
        filename: "Pack/2024-25/April/GSTR-3B.pdf",
        period: "April",
        requestId: "request-1",
        returnPeriod: "042024",
        tabId: 17,
      }),
    ).resolves.toEqual({
      downloadId: 9,
      ok: true,
      safeSignals: ["filed-gstr3b-portal-blob-download-captured"],
    });
    expect(mocks.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          expect.objectContaining({
            expectedTarget: { financialYear: "2024-25", period: "April", returnType: "GSTR-3B" },
          }),
        ],
        target: { tabId: 17 },
        world: "MAIN",
      }),
    );
    expect(mocks.downloadAcquiredArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "Pack/2024-25/April/GSTR-3B.pdf" }),
    );
    expect(mocks.removeListener).toHaveBeenCalledOnce();
  });

  it("fails closed without delivering HTML or a malformed PDF", async () => {
    mocks.executeScript.mockResolvedValue([
      {
        result: {
          ok: true,
          base64: Buffer.from("<html>synthetic denial</html>").toString("base64"),
          blobUrl: "blob:synthetic/gstr3b",
          safeSignals: [],
        },
      },
    ]);
    await expect(
      acquireGstr3bPdfAfterPreflight({
        financialYear: "2024-25",
        filename: "Pack/2024-25/April/GSTR-3B.pdf",
        period: "April",
        requestId: "request-2",
        returnPeriod: "042024",
        tabId: 17,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "unexpected-content" });
    expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
  });

  it("hands validated PDF bytes to a caller-supplied staged delivery without starting a download", async () => {
    const bytes = new Uint8Array(1024);
    bytes.set(new TextEncoder().encode("%PDF-1.7"));
    const deliver = vi.fn(async () => ({
      ok: true as const,
      safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
    }));
    mocks.executeScript.mockResolvedValue([
      {
        result: {
          ok: true,
          base64: Buffer.from(bytes).toString("base64"),
          blobUrl: "blob:synthetic/gstr3b",
          safeSignals: ["filed-gstr3b-portal-blob-download-captured"],
        },
      },
    ]);

    await expect(
      acquireGstr3bPdfAfterPreflight({
        deliver,
        financialYear: "2024-25",
        filename: "Pack/2024-25/April/GSTR-3B.pdf",
        period: "April",
        requestId: "request-staged",
        returnPeriod: "042024",
        tabId: 17,
      }),
    ).resolves.toEqual({
      ok: true,
      safeSignals: [
        "filed-gstr3b-portal-blob-download-captured",
        "full-fiscal-year-opfs-staged:PDF",
      ],
    });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "application/pdf" }));
    expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
  });

  describe("one automatic re-click after a silent generation timeout (#386)", () => {
    // Live, 2026-09-21: 38 GSTR-3B captures took 0.2-1.5 s and 8 more produced nothing for the full
    // 20 s; a manual retry then succeeded each time. So the first wait is short, and a timeout with
    // no browser download at all gets one more click, which the owner approved. Any download seen
    // from the tab means the portal did act, and that stays the existing review path.
    const pdf = () => {
      const bytes = new Uint8Array(1024);
      bytes.set(new TextEncoder().encode("%PDF-1.7"));
      return Buffer.from(bytes).toString("base64");
    };
    const input = {
      deliver: async () => ({ ok: true as const, safeSignals: [] }),
      financialYear: "2024-25",
      filename: "synthetic.pdf",
      period: "April",
      requestId: "reclick",
      returnPeriod: "042024",
      tabId: 17,
    };
    const timeoutArgs = () =>
      mocks.executeScript.mock.calls.map(
        (call) => (call[0] as { args: [{ timeoutMs?: number }] }).args[0].timeoutMs,
      );

    it("clicks once more after a short silent timeout and keeps the file", async () => {
      mocks.executeScript
        .mockResolvedValueOnce([
          { result: { ok: false, reason: "generation-timeout", safeSignals: [] } },
        ])
        .mockResolvedValueOnce([
          { result: { ok: true, base64: pdf(), blobUrl: "blob:synthetic/3b", safeSignals: [] } },
        ]);

      const result = await acquireGstr3bPdfAfterPreflight(input);

      expect(result).toMatchObject({ ok: true });
      expect(result.safeSignals).toContain("filed-gstr3b-capture-reclicked");
      expect(timeoutArgs()).toEqual([GSTR3B_FIRST_CAPTURE_WAIT_MS, GSTR3B_RECLICK_CAPTURE_WAIT_MS]);
      expect(GSTR3B_FIRST_CAPTURE_WAIT_MS + GSTR3B_RECLICK_CAPTURE_WAIT_MS).toBeLessThanOrEqual(
        20_000,
      );
    });

    it("re-clicks at most once", async () => {
      mocks.executeScript.mockResolvedValue([
        { result: { ok: false, reason: "generation-timeout", safeSignals: [] } },
      ]);

      const result = await acquireGstr3bPdfAfterPreflight(input);
      expect(result).toMatchObject({ ok: false, reason: "generation-timeout" });
      // Two clicks reached the portal; a review of the failed target must be able to see that.
      expect(result.safeSignals).toContain("filed-gstr3b-capture-reclicked");
      expect(mocks.executeScript).toHaveBeenCalledTimes(2);
    });

    it("does not re-click when the browser saw any download from the tab", async () => {
      mocks.executeScript.mockImplementationOnce(async () => {
        const listener = mocks.addListener.mock.calls.at(-1)?.[0] as
          ((item: { id: number; tabId?: number; url?: string }) => void) | undefined;
        listener?.({ id: 5, tabId: 17, url: "blob:https://return.gst.gov.in/late" });
        return [{ result: { ok: false, reason: "generation-timeout", safeSignals: [] } }];
      });

      await expect(acquireGstr3bPdfAfterPreflight(input)).resolves.toMatchObject({
        ok: false,
        reason: "generation-timeout",
      });
      expect(mocks.executeScript).toHaveBeenCalledTimes(1);
    });

    it.each(["control-not-found", "page-period-mismatch", "too-large", "unexpected-content"])(
      "does not re-click after %s",
      async (reason) => {
        mocks.executeScript.mockResolvedValue([{ result: { ok: false, reason, safeSignals: [] } }]);
        await acquireGstr3bPdfAfterPreflight(input);
        expect(mocks.executeScript).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("distinguishes an absent MAIN-world result from portal generation timeout", async () => {
    mocks.executeScript.mockResolvedValue([]);

    await expect(
      acquireGstr3bPdfAfterPreflight({
        financialYear: "2024-25",
        filename: "synthetic.pdf",
        period: "April",
        requestId: "missing-main-world-result",
        returnPeriod: "042024",
        tabId: 17,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "main-world-execution-failed" });
    expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
  });
});

describe("GSTR-2B page-generated acquisition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the configured XLSX MIME, validates PK bytes, and delivers one owned download", async () => {
    const bytes = new Uint8Array(1024);
    bytes.set([0x50, 0x4b]);
    mocks.executeScript.mockResolvedValue([
      {
        result: {
          ok: true,
          base64: Buffer.from(bytes).toString("base64"),
          blobUrl: "blob:synthetic/gstr2b",
          safeSignals: ["portal-blob-shim-suppressed-via-dispatchEvent"],
        },
      },
    ]);
    await expect(
      acquirePageGeneratedArtifact({
        artifactType: "EXCEL",
        financialYear: "2024-25",
        period: "April",
        requestId: "request-2b",
        returnPeriod: "042024",
        returnType: "GSTR-2B",
        tabId: 17,
      }),
    ).resolves.toMatchObject({ ok: true, mimeType: expect.stringContaining("spreadsheet") });
    expect(mocks.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          expect.objectContaining({
            expectedControlText: "DOWNLOAD GSTR-2B DETAILS (EXCEL)",
            expectedMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            expectedPeriodTexts: ["April", "Apr"],
            expectedTarget: {
              financialYear: "2024-25",
              period: "April",
              returnType: "GSTR-2B",
            },
          }),
        ],
        target: { tabId: 17 },
        world: "MAIN",
      }),
    );
  });

  it("reports a GSTR-1 portal generation timeout without delivering a file", async () => {
    mocks.executeScript.mockResolvedValue([
      { result: { ok: false, reason: "generation-timeout", safeSignals: [] } },
    ]);

    await expect(
      acquirePageGeneratedArtifact({
        artifactType: "PDF",
        financialYear: "2024-25",
        period: "April",
        requestId: "gstr1-timeout",
        returnPeriod: "042024",
        returnType: "GSTR-1",
        tabId: 17,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "generation-timeout" });
    expect(mocks.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          expect.objectContaining({
            expectedTarget: {
              financialYear: "2024-25",
              period: "April",
              returnType: "GSTR-1",
            },
          }),
        ],
      }),
    );
    expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
  });

  it.each([
    ["GSTR-1", "EXCEL", true],
    ["GSTR-1", "PDF", false],
    ["GSTR-2B", "EXCEL", false],
    ["GSTR-2B", "PDF", false],
  ] as const)(
    "lets only %s %s stop waiting on the no-details dialog (#386)",
    async (returnType, artifactType, watches) => {
      mocks.executeScript.mockResolvedValue([
        { result: { ok: false, reason: "generation-timeout", safeSignals: [] } },
      ]);
      await acquirePageGeneratedArtifact({
        artifactType,
        financialYear: "2024-25",
        period: "April",
        requestId: `watch-${returnType}-${artifactType}`,
        returnPeriod: "042024",
        returnType,
        tabId: 17,
      });
      const [call] = mocks.executeScript.mock.calls;
      const args = (call?.[0] as { args: [Record<string, unknown>] }).args[0];
      if (watches) {
        expect(args.stopWhenDialogShows).toEqual({
          selector: GSTR1_EXCEL_NO_DETAILS_DIALOG_SELECTOR,
          textPatterns: GSTR1_EXCEL_NO_DETAILS_TEXT_PATTERNS,
        });
      } else {
        expect(args).not.toHaveProperty("stopWhenDialogShows");
      }
    },
  );

  it("fails closed when MAIN-world execution rejects", async () => {
    mocks.executeScript.mockRejectedValue(new Error("synthetic execution rejection"));

    await expect(
      acquirePageGeneratedArtifact({
        artifactType: "PDF",
        financialYear: "2024-25",
        period: "April",
        requestId: "rejected-main-world-execution",
        returnPeriod: "042024",
        returnType: "GSTR-1",
        tabId: 17,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "main-world-execution-failed" });
    expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
  });
});

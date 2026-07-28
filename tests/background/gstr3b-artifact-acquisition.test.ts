import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ArtifactDownloadModule from "../../src/background/artifact-download";
const mocks = vi.hoisted(() => ({
  executeScript: vi.fn(),
  removeListener: vi.fn(),
  downloadAcquiredArtifact: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: {
    scripting: { executeScript: mocks.executeScript },
    downloads: { onCreated: { addListener: vi.fn(), removeListener: mocks.removeListener } },
  },
}));
vi.mock("../../src/background/artifact-download", async (importOriginal) => ({
  ...(await importOriginal<typeof ArtifactDownloadModule>()),
  downloadAcquiredArtifact: mocks.downloadAcquiredArtifact,
}));

import { acquireGstr3bPdfAfterPreflight } from "../../src/background/gstr3b-artifact-acquisition";
import { acquirePageGeneratedArtifact } from "../../src/background/gstr2b-artifact-acquisition";

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
          safeSignals: ["portal-blob-shim-suppressed-via-dispatchEvent"],
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
        filename: "Pack/2024-25/April/GSTR-3B.pdf",
        requestId: "request-1",
        returnPeriod: "042024",
        tabId: 17,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 17 }, world: "MAIN" }),
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
          safeSignals: [],
        },
      },
    ]);
    await expect(
      acquireGstr3bPdfAfterPreflight({
        filename: "Pack/2024-25/April/GSTR-3B.pdf",
        requestId: "request-2",
        returnPeriod: "042024",
        tabId: 17,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "unexpected-content" });
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
          safeSignals: ["portal-blob-shim-suppressed-via-dispatchEvent"],
        },
      },
    ]);
    await expect(
      acquirePageGeneratedArtifact({
        artifactType: "EXCEL",
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
            expectedMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
        requestId: "gstr1-timeout",
        returnPeriod: "042024",
        returnType: "GSTR-1",
        tabId: 17,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "generation-timeout" });
    expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FilenameReassertionModule from "../../src/background/pack-download-filename-reassertion";
import type { FiledReturnsFullFiscalYearLedger } from "../../src/connectors/gst/filed-returns-contracts";

const mocks = vi.hoisted(() => {
  const reservation = { bind: vi.fn(), release: vi.fn() };
  return {
    browser: {
      downloads: {
        download: vi.fn(),
        search: vi.fn(),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
    closeOffscreenBlobDocument: vi.fn(),
    createOffscreenFiledReturnZipUrl: vi.fn(),
    clearOffscreenFiledReturnLedger: vi.fn(),
    observeBrowserDownloadById: vi.fn(),
    reservation,
    reserve: vi.fn(() => reservation),
    revokeOffscreenBlobUrl: vi.fn(),
  };
});

vi.mock("wxt/browser", () => ({ browser: mocks.browser }));
vi.mock("../../src/background/offscreen-blob-url", () => ({
  clearAllOffscreenFiledReturnLedgers: vi.fn(),
  clearOffscreenFiledReturnLedger: mocks.clearOffscreenFiledReturnLedger,
  closeOffscreenBlobDocument: mocks.closeOffscreenBlobDocument,
  createOffscreenFiledReturnZipUrl: mocks.createOffscreenFiledReturnZipUrl,
  revokeOffscreenBlobUrl: mocks.revokeOffscreenBlobUrl,
}));
vi.mock("../../src/background/download-observer", () => ({
  observeBrowserDownloadById: mocks.observeBrowserDownloadById,
}));
vi.mock("../../src/background/filed-returns-full-fiscal-year-ledger", () => ({
  canCompleteFullFiscalYearLedger: vi.fn(() => true),
  hasCanonicalFullFiscalYearTargetPlan: vi.fn(() => true),
}));
vi.mock("../../src/background/pack-download-filename-reassertion", async (importOriginal) => {
  const actual = await importOriginal<typeof FilenameReassertionModule>();
  return {
    ...actual,
    installPackDownloadFilenameReassertion: () => ({ reserve: mocks.reserve }),
  };
});

import {
  exportFullFiscalYearZip,
  exportSinglePeriodFiledReturnsZip,
} from "../../src/background/filed-returns-full-fiscal-year-zip";

describe("filed-return ZIP filename reassertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOffscreenFiledReturnZipUrl.mockResolvedValue({
      status: "created",
      blobUrl: "blob:pack-owned/zip",
      zipEntryCount: 3,
    });
    mocks.clearOffscreenFiledReturnLedger.mockResolvedValue("cleared");
    mocks.observeBrowserDownloadById.mockResolvedValue({
      state: "completed",
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "The synthetic ZIP completed.",
    });
    mocks.browser.downloads.download.mockResolvedValue(91);
    mocks.browser.downloads.search.mockResolvedValue([
      { id: 91, state: "complete", filename: "/synthetic/Downloads/bundle-output.zip" },
    ]);
  });

  it("reserves the single-period ZIP filename before download starts and reports a final basename mismatch", async () => {
    mocks.browser.downloads.download.mockImplementation(async () => {
      expect(mocks.reserve).toHaveBeenCalledWith(
        "blob:pack-owned/zip",
        "ComplyEaze-Pack/2026-27/GSTR-2B/April.zip",
      );
      return 91;
    });

    const result = await exportSinglePeriodFiledReturnsZip({
      completeStep: completeStep(),
      entryPlan: { artifactTypes: ["PDF", "EXCEL", "JSON"], unavailableArtifactTypes: [] },
      ledgerId: "single-period:12345678-test",
      options: {
        onAfterStagingCleared: vi.fn(async () => undefined),
        onBeforeDownloadStart: vi.fn(async () => undefined),
        onDownloadStarted: vi.fn(async () => undefined),
      },
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-2B",
      },
    });

    expect(mocks.reservation.bind).toHaveBeenCalledWith(91);
    expect(mocks.reservation.release).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      state: "downloaded",
      safeSignals: expect.arrayContaining(["zip-download-filename-overridden"]),
      safeMessage:
        "Pack exported the selected filed-return files as one local zip. Pack completed the ZIP download, but the browser saved it under a different name. Check browser Downloads before using the file.",
    });
  });

  it("uses the same reservation lifecycle for the full-fiscal-year ZIP path", async () => {
    mocks.createOffscreenFiledReturnZipUrl.mockResolvedValueOnce({
      status: "created",
      blobUrl: "blob:pack-owned/full-year-zip",
      zipEntryCount: 1,
    });
    mocks.browser.downloads.search.mockResolvedValueOnce([
      {
        id: 91,
        state: "complete",
        filename: "/synthetic/Downloads/GSTR-3B-2026-27-full-year.zip",
      },
    ]);

    await exportFullFiscalYearZip(fullYearLedger(), completeStep());

    expect(mocks.reserve).toHaveBeenCalledWith(
      "blob:pack-owned/full-year-zip",
      "gstr-3b-2026-27-full-year.zip",
    );
    expect(mocks.reservation.bind).toHaveBeenCalledWith(91);
    expect(mocks.reservation.release).toHaveBeenCalledOnce();
  });

  it("releases the ZIP filename reservation when the browser rejects the start", async () => {
    mocks.browser.downloads.download.mockRejectedValueOnce(new Error("synthetic rejection"));

    const result = await exportSinglePeriodFiledReturnsZip({
      completeStep: completeStep(),
      entryPlan: { artifactTypes: ["PDF", "EXCEL", "JSON"], unavailableArtifactTypes: [] },
      ledgerId: "single-period:12345678-test",
      options: {
        onAfterStagingCleared: vi.fn(async () => undefined),
        onBeforeDownloadStart: vi.fn(async () => undefined),
        onDownloadStarted: vi.fn(async () => undefined),
      },
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-2B",
      },
    });

    expect(result).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining(["single-period-zip-download-start-rejected"]),
      safeMessage:
        "Pack prepared the selected filed-return zip, but the browser rejected the final save.",
    });
    expect(mocks.reservation.release).toHaveBeenCalledOnce();
  });

  it("releases the ZIP filename reservation when the observed download fails", async () => {
    mocks.observeBrowserDownloadById.mockResolvedValueOnce({
      state: "failed",
      safeSignals: ["browser-download-interrupted"],
      safeMessage: "The synthetic ZIP was interrupted.",
    });

    const result = await exportSinglePeriodFiledReturnsZip({
      completeStep: completeStep(),
      entryPlan: { artifactTypes: ["PDF", "EXCEL", "JSON"], unavailableArtifactTypes: [] },
      ledgerId: "single-period:12345678-test",
      options: {
        onAfterStagingCleared: vi.fn(async () => undefined),
        onBeforeDownloadStart: vi.fn(async () => undefined),
        onDownloadStarted: vi.fn(async () => undefined),
      },
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-2B",
      },
    });

    expect(result).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining(["single-period-zip-download-unconfirmed"]),
      safeMessage:
        "Pack prepared the selected filed-return zip, but the final browser download did not complete.",
    });
    expect(mocks.reservation.release).toHaveBeenCalledOnce();
  });
});

function completeStep() {
  return {
    connectorId: "gst" as const,
    scopeId: "gst-filed-returns-gstr2b-private-v0",
    state: "downloaded" as const,
    safeSignals: ["single-period-opfs-staged"],
    safeMessage: "Synthetic files staged.",
  };
}

function fullYearLedger(): FiledReturnsFullFiscalYearLedger {
  return {
    schemaVersion: "1.0",
    ledgerId: "11111111111111111111",
    revision: 1,
    status: "complete",
    scope: {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "ALL",
      returnType: "GSTR-3B",
    },
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    targets: [
      {
        targetId: "GSTR-3B:2026-27:April:PDF",
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-3B",
        status: "downloaded",
        attempts: 1,
        safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
        safeMessage: "Synthetic target staged.",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ],
  };
}

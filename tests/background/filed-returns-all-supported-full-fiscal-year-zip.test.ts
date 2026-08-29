import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FilenameReassertionModule from "../../src/background/pack-download-filename-reassertion";
import {
  createAllSupportedFullFiscalYearLedger,
  markAllSupportedFullFiscalYearTargetTerminal,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-ledger";
import type { FiledReturnsAllSupportedFullFiscalYearTarget } from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";
import { FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND } from "../../src/connectors/gst/filed-returns-contracts";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { isPackOffscreenBlobUrlMessage } from "../../src/connectors/gst/filed-returns-offscreen-validation";
import type {
  FiledReturnsDownloadDiagnostic,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";

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
    extensionBlobUrlFingerprint: vi.fn(async () => "synthetic-fingerprint"),
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
vi.mock("../../src/background/filed-returns-durable-download-reconciler", () => ({
  beginPendingExtensionDownloadUrl: vi.fn(() => () => undefined),
  extensionBlobUrlFingerprint: mocks.extensionBlobUrlFingerprint,
}));
vi.mock("../../src/background/pack-download-filename-reassertion", async (importOriginal) => {
  const actual = await importOriginal<typeof FilenameReassertionModule>();
  return {
    ...actual,
    installPackDownloadFilenameReassertion: () => ({ reserve: mocks.reserve }),
  };
});

import { exportAllSupportedFullFiscalYearZip } from "../../src/background/filed-returns-all-supported-full-fiscal-year-zip";
import { isAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";

const NOW = new Date("2026-08-27T00:00:00.000Z");

describe("all-supported full-fiscal-year ZIP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOffscreenFiledReturnZipUrl.mockResolvedValue({
      status: "created",
      blobUrl: "blob:pack-owned/all-supported-full-year-zip",
      zipEntryCount: 7,
      artifactEntryCount: 7,
      summaryEntryCount: 0,
      summary: { status: "failed", reasonCategory: "generation-failed" },
    });
    mocks.extensionBlobUrlFingerprint.mockResolvedValue("synthetic-fingerprint");
    mocks.observeBrowserDownloadById.mockResolvedValue({
      state: "completed",
      safeSignals: ["browser-download-completed", "browser-download-non-empty"],
      safeMessage: "Synthetic ZIP completed.",
    });
    mocks.browser.downloads.download.mockResolvedValue(91);
    mocks.browser.downloads.search.mockResolvedValue([
      { id: 91, state: "complete", filename: "/synthetic/Downloads/all-supported.zip" },
    ]);
  });

  it("binds same-period artifacts to their return-type directories and exact per-entry types", async () => {
    const ledger = completedLedger();
    expect(isAllSupportedFullFiscalYearLedger(ledger)).toBe(true);

    const result = await exportAllSupportedFullFiscalYearZip(ledger, completeStep());

    expect(result.state).toBe("downloaded");
    expect(mocks.createOffscreenFiledReturnZipUrl).toHaveBeenCalledWith(
      ledger.ledgerId,
      expect.objectContaining({
        entryCount: 7,
        entries: expect.arrayContaining([
          { artifactType: "PDF", entryNames: ["gstr-1/april-summary.pdf"], returnType: "GSTR-1" },
          { artifactType: "JSON", entryNames: ["gstr-3b/april-data.json"], returnType: "GSTR-3B" },
        ]),
        summaryPlan: expect.arrayContaining([
          expect.objectContaining({ period: "April", returnType: "GSTR-1" }),
          expect.objectContaining({ period: "April", returnType: "GSTR-3B" }),
        ]),
      }),
    );
    expect(mocks.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "ComplyEaze-Pack/2025-26/all-supported-returns-full-year.zip",
      }),
    );
  });

  it("does not export a ledger whose staged-artifact correlation was removed", async () => {
    const ledger = completedLedger();
    const missing = {
      ...ledger,
      targets: ledger.targets.map((target) =>
        target.returnType === "GSTR-3B"
          ? {
              ...target,
              safeSignals: target.safeSignals.filter((signal) => !signal.endsWith(":JSON")),
            }
          : target,
      ),
    };
    expect(isAllSupportedFullFiscalYearLedger(missing)).toBe(false);

    const result = await exportAllSupportedFullFiscalYearZip(missing, completeStep());

    expect(result).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "all-supported-full-fiscal-year-zip-target-plan-invalid",
      ]),
    });
    expect(mocks.createOffscreenFiledReturnZipUrl).not.toHaveBeenCalled();
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
  });

  it("rejects a cross-return path collision before the offscreen worker can build a ZIP", () => {
    const message = {
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: "pack-offscreen-blob-url",
      payload: {
        requestId: "cross-return-plan",
        ledgerId: "full-fiscal-year-12345678",
        expectedEntryCount: 2,
        expectedEntries: [
          {
            artifactType: "PDF",
            entryNames: ["gstr-1/april-summary.pdf"],
            returnType: "GSTR-1",
          },
          {
            artifactType: "PDF",
            entryNames: ["gstr-3b/april-return.pdf"],
            returnType: "GSTR-3B",
          },
        ],
        generatedAt: "2026-08-27T00:00:00.000Z",
      },
    } as const;
    expect(isPackOffscreenBlobUrlMessage(message)).toBe(true);

    const collided = {
      ...message,
      payload: {
        ...message.payload,
        expectedEntries: [
          message.payload.expectedEntries[0],
          {
            ...message.payload.expectedEntries[1],
            entryNames: ["gstr-1/april-summary.pdf"],
          },
        ],
      },
    };
    expect(isPackOffscreenBlobUrlMessage(collided)).toBe(false);
  });
});

function completedLedger() {
  const initial = createAllSupportedFullFiscalYearLedger(
    {
      kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
      financialYear: "2025-26",
    },
    expandedPlan(),
    ["April"],
    NOW,
  );
  return initial.targets.reduce(
    (ledger, target, index) =>
      markAllSupportedFullFiscalYearTargetTerminal(
        ledger,
        target.targetId,
        "downloaded",
        stagedTargetStep(target),
        new Date(NOW.getTime() + (index + 1) * 1_000),
      ),
    initial,
  );
}

function completeStep() {
  return {
    connectorId: "gst" as const,
    scopeId: "gst-filed-returns-all-supported-private-v0",
    state: "downloaded" as const,
    safeSignals: ["all-supported-full-fiscal-year-opfs-staged"],
    safeMessage: "Synthetic files staged.",
  };
}

function stagedTargetStep(
  target: FiledReturnsAllSupportedFullFiscalYearTarget,
): PortalFlowStepResult {
  const diagnostics: FiledReturnsDownloadDiagnostic[] = target.concreteArtifactTypes.map(
    (artifactType) => ({
      actionId: `action-12345678-${artifactType.toLowerCase()}`,
      artifactType,
      byteCountClass: "non-empty" as const,
      downloadPathClass: "captured-portal-request-data" as const,
      endpointClass:
        target.returnType === "GSTR-1"
          ? artifactType === "EXCEL"
            ? "gstr1-excel-portal-blob-captured-download"
            : "gstr1-pdf-portal-blob-captured-download"
          : target.returnType === "GSTR-3B"
            ? artifactType === "JSON"
              ? "gstr3b-main-world-json-captured-download"
              : "gstr3b-portal-blob-captured-download"
            : artifactType === "JSON"
              ? "gstr2b-main-world-json-captured-download"
              : "gstr2b-portal-blob-captured-download",
      eventType: "filed-return-download-path" as const,
      financialYear: target.financialYear,
      mimeClass:
        artifactType === "PDF"
          ? ("pdf" as const)
          : artifactType === "JSON"
            ? ("json" as const)
            : ("spreadsheet" as const),
      period: target.period,
      returnType: target.returnType,
      schemaVersion: "1.0" as const,
      status: "downloaded" as const,
    }),
  );
  return {
    connectorId: "gst" as const,
    downloadDiagnostic: diagnostics[diagnostics.length - 1]!,
    downloadDiagnostics: diagnostics,
    safeMessage: "Pack staged the target-bound artifact.",
    safeSignals: [
      ...target.concreteArtifactTypes.map(
        (artifactType) => `filed-return-artifact-downloaded:${artifactType}`,
      ),
      "all-supported-full-fiscal-year-opfs-staged",
      ...target.concreteArtifactTypes.map(
        (artifactType) => `all-supported-full-fiscal-year-opfs-staged:${artifactType}`,
      ),
    ],
    scopeId: "gst-filed-returns-private-v0",
    state: "downloaded" as const,
  };
}

function expandedPlan() {
  const expansion = expandAllSupportedFullFiscalYearTargetPlan();
  if (!expansion.ok) throw new Error("expected all-supported return plan");
  return expansion.targets;
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { observeBrowserDownloadById } from "../../src/background/download-observer";
import { exportSinglePeriodFiledReturnsZip } from "../../src/background/filed-returns-full-fiscal-year-zip";

const browserMocks = vi.hoisted(() => {
  const localValues: Record<string, unknown> = {};
  return {
    clearLocalValues: () => {
      for (const key of Object.keys(localValues)) delete localValues[key];
    },
    downloads: {
      download: vi.fn(async () => 91),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in localValues ? { [key]: localValues[key] } : {})),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(localValues, values);
        }),
      },
    },
  };
});

const offscreenMocks = vi.hoisted(() => ({
  clearOffscreenFiledReturnLedger: vi.fn(async () => "cleared"),
  closeOffscreenBlobDocument: vi.fn(async () => undefined),
  createOffscreenFiledReturnZipUrl: vi.fn(async () => ({
    blobUrl: "blob:chrome-extension://pack/archive.zip",
    zipEntryCount: 2,
  })),
  revokeOffscreenBlobUrl: vi.fn(async () => undefined),
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));
vi.mock("../../src/background/offscreen-blob-url", () => ({
  clearAllOffscreenFiledReturnLedgers: vi.fn(async () => "cleared"),
  ...offscreenMocks,
}));
vi.mock("../../src/background/download-observer", () => ({
  observeBrowserDownloadById: vi.fn(async () => ({
    state: "completed",
    safeSignals: ["browser-download-completed", "browser-download-non-empty"],
    safeMessage: "Completed.",
  })),
}));
vi.mock("../../src/background/filed-returns-artifact-progress", () => ({
  clearSinglePeriodStagingRecord: vi.fn(async () => undefined),
}));

const SCOPE = {
  artifactType: "PDF_AND_EXCEL" as const,
  financialYear: "2026-27",
  period: "May",
  returnType: "GSTR-2B" as const,
};

const COMPLETE_STEP = {
  connectorId: "gst" as const,
  scopeId: "gst-gstr2b-private-v0",
  state: "downloaded" as const,
  safeSignals: ["single-period-opfs-staged"],
  safeMessage: "Staged.",
};

describe("filed returns ZIP action journal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.clearLocalValues();
  });

  it("arms, binds, and verifies the final ZIP before reporting success", async () => {
    const result = await exportSinglePeriodFiledReturnsZip({
      actionJournalKey: "action-journal",
      completeStep: COMPLETE_STEP,
      ledgerId: "single-period:ledger-1",
      scope: SCOPE,
    });

    expect(result).toMatchObject({ state: "downloaded" });
    expect(browserMocks.downloads.download).toHaveBeenCalledTimes(1);
    const writes = browserMocks.storage.local.set.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const journalWrites = writes
      .map((call) => call[0]["action-journal"])
      .filter((value): value is { entries: Array<{ state: string }> } => Boolean(value));
    expect(journalWrites.map((journal) => journal.entries[0]?.state)).toEqual([
      "armed",
      "evidence-bound",
      "verified",
    ]);
  });

  it("does not start another ZIP when an earlier ZIP action is unresolved", async () => {
    browserMocks.storage.local.get.mockImplementationOnce(async () => ({
      "action-journal": {
        schemaVersion: "1.0",
        entries: [
          {
            actionId: "zip-earlier",
            artifactType: "ZIP",
            attempt: 1,
            revision: 1,
            state: "armed",
            targetId: "single-period:ledger-1:ZIP",
            armedAt: "2026-07-21T00:00:00.000Z",
          },
        ],
      },
    }));

    const result = await exportSinglePeriodFiledReturnsZip({
      actionJournalKey: "action-journal",
      completeStep: COMPLETE_STEP,
      ledgerId: "single-period:ledger-1",
      scope: SCOPE,
    });

    expect(result).toMatchObject({
      state: "download-unconfirmed",
      safeSignals: expect.arrayContaining(["single-period-zip-action-journal-review-required"]),
    });
    expect(browserMocks.downloads.download).not.toHaveBeenCalled();
  });

  it("retains staged files when the final ZIP observation is ambiguous", async () => {
    vi.mocked(observeBrowserDownloadById).mockResolvedValueOnce({
      state: "not-observed",
      safeSignals: ["browser-download-size-unknown"],
      safeMessage: "Size unknown.",
    });

    const result = await exportSinglePeriodFiledReturnsZip({
      actionJournalKey: "action-journal",
      completeStep: COMPLETE_STEP,
      ledgerId: "single-period:ledger-1",
      scope: SCOPE,
    });

    expect(result).toMatchObject({
      state: "download-unconfirmed",
      safeSignals: expect.arrayContaining(["single-period-opfs-retained"]),
    });
    expect(offscreenMocks.clearOffscreenFiledReturnLedger).not.toHaveBeenCalled();
    const writes = browserMocks.storage.local.set.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const journalWrites = writes
      .map((call) => call[0]["action-journal"])
      .filter((value): value is { entries: Array<{ state: string }> } => Boolean(value));
    expect(journalWrites.at(-1)?.entries[0]?.state).toBe("review-required");
  });
});

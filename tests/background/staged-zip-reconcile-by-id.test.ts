import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalFlowStepResult } from "../../src/connectors/gst/filed-returns-contracts";
import type * as DownloadObserver from "../../src/background/download-observer";
import type * as AllSupportedValidation from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";

// Both full-year paths reconcile a started final ZIP by its exact browser download ID. They were
// two copies differing only in their signal prefix (#383). This pins every outcome of both, with
// the prefix as the only difference, so consolidating them cannot change what either reports.

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  observe: vi.fn(),
  isAllSupportedLedger: vi.fn(() => true),
}));

vi.mock("wxt/browser", () => ({ browser: { downloads: { search: mocks.search } } }));
vi.mock("../../src/background/download-observer", async (importOriginal) => ({
  ...(await importOriginal<typeof DownloadObserver>()),
  observeBrowserDownloadById: mocks.observe,
}));
vi.mock(
  "../../src/background/filed-returns-all-supported-full-fiscal-year-validation",
  async (importOriginal) => ({
    ...(await importOriginal<typeof AllSupportedValidation>()),
    isAllSupportedFullFiscalYearLedger: mocks.isAllSupportedLedger,
  }),
);

import { reconcileFullFiscalYearZipDownload } from "../../src/background/filed-returns-full-fiscal-year-zip";
import { reconcileAllSupportedFullFiscalYearZipDownload } from "../../src/background/filed-returns-all-supported-full-fiscal-year-zip";

const COMPLETE_STEP: PortalFlowStepResult = {
  connectorId: "gst",
  scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
  state: "ready",
  safeSignals: ["synthetic-complete"],
  safeMessage: "Synthetic complete step.",
};

const observing = {
  zipPhase: "download-observing",
  zipDownloadAttempt: { requestedAt: "2026-09-17T00:00:00.000Z", downloadId: 41 },
};

type Reconcile = (ledger: never, step: PortalFlowStepResult) => Promise<PortalFlowStepResult>;
const kinds: [string, Reconcile][] = [
  ["full-fiscal-year", reconcileFullFiscalYearZipDownload as unknown as Reconcile],
  [
    "all-supported-full-fiscal-year",
    reconcileAllSupportedFullFiscalYearZipDownload as unknown as Reconcile,
  ],
];

const outcomes: [string, () => void, Record<string, unknown>][] = [
  [
    "missing download ID",
    () => undefined,
    {
      zipPhase: "download-observing",
      zipDownloadAttempt: { requestedAt: "2026-09-17T00:00:00.000Z" },
    },
  ],
  ["wrong phase", () => undefined, { ...observing, zipPhase: "export-pending" }],
  ["search unavailable", () => mocks.search.mockRejectedValue(new Error("x")), observing],
  ["ID not found", () => mocks.search.mockResolvedValue([]), observing],
  ["unknown state", () => mocks.search.mockResolvedValue([{ id: 41, state: "weird" }]), observing],
  [
    "completed",
    () => {
      mocks.search.mockResolvedValue([{ id: 41, state: "complete" }]);
      mocks.observe.mockResolvedValue({
        state: "completed",
        safeSignals: ["obs-ok"],
        safeMessage: "ok",
      });
    },
    observing,
  ],
  [
    "failed with action",
    () => {
      mocks.search.mockResolvedValue([{ id: 41, state: "interrupted" }]);
      mocks.observe.mockResolvedValue({
        state: "failed",
        safeSignals: ["obs-failed"],
        safeMessage: "failed",
        userAction: { type: "RETRY_PORTAL_GENERATION", message: "synthetic", canResume: false },
      });
    },
    observing,
  ],
  [
    "failed without action",
    () => {
      mocks.search.mockResolvedValue([{ id: 41, state: "interrupted" }]);
      mocks.observe.mockResolvedValue({
        state: "failed",
        safeSignals: ["obs-failed"],
        safeMessage: "failed",
      });
    },
    observing,
  ],
  [
    "not observed",
    () => {
      mocks.search.mockResolvedValue([{ id: 41, state: "in_progress" }]);
      mocks.observe.mockResolvedValue({
        state: "not-observed",
        safeSignals: ["obs-none"],
        safeMessage: "none",
      });
    },
    observing,
  ],
];

describe("exact-ID final ZIP reconciliation, both full-year paths (#383)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAllSupportedLedger.mockReturnValue(true);
  });

  it.each(outcomes)(
    "reports %s identically apart from the kind prefix",
    async (_name, arrange, ledger) => {
      const results: string[] = [];
      for (const [kind, reconcile] of kinds) {
        vi.clearAllMocks();
        mocks.isAllSupportedLedger.mockReturnValue(true);
        arrange();
        const step = await reconcile(ledger as never, COMPLETE_STEP);
        results.push(JSON.stringify(step).replaceAll(kind, "<KIND>"));
        expect(step).toMatchSnapshot(kind);
      }
      expect(results[1]).toBe(results[0]);
    },
  );

  it("refuses an invalid all-supported ledger before searching", async () => {
    mocks.isAllSupportedLedger.mockReturnValue(false);
    const step = await reconcileAllSupportedFullFiscalYearZipDownload(
      observing as never,
      COMPLETE_STEP,
    );
    expect(step.safeSignals).toContain("all-supported-full-fiscal-year-zip-ledger-invalid");
    expect(mocks.search).not.toHaveBeenCalled();
  });
});

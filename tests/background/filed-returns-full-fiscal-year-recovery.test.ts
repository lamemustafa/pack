import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFullFiscalYearLedger } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import {
  prepareFullFiscalYearTargetRetry,
  resolveFullFiscalYearTarget,
} from "../../src/background/filed-returns-full-fiscal-year-recovery";
import { browser } from "wxt/browser";

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    session: {
      set: vi.fn(async () => undefined),
    },
  },
}));
const zipMocks = vi.hoisted(() => ({
  discardFullFiscalYearFiledReturnsZip: vi.fn(async () => "full-fiscal-year-opfs-cleared"),
}));

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => zipMocks);

describe("full fiscal-year recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockResolvedValue(
      "full-fiscal-year-opfs-cleared",
    );
  });

  it("rejects stale target recovery revisions without mutating storage", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({ revision: 3 }),
    });

    const recovery = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(recovery).toMatchObject({
      ok: false,
      response: {
        ok: true,
        flowStep: {
          safeSignals: ["full-fiscal-year-recovery-stale"],
        },
      },
    });
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it("resets one recoverable target for retry and clears legacy single-period review state", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({ revision: 2 }),
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-3B:2026-27:April",
        status: "download-unconfirmed",
        scope: {
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-3B",
        },
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Unconfirmed.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    const recovery = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(recovery).toMatchObject({
      ok: true,
      ledger: {
        revision: 3,
        status: "running",
        currentTargetId: "GSTR-3B:2026-27:April",
        targets: [expect.objectContaining({ period: "April", status: "pending" })],
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        revision: 3,
        targets: [expect.objectContaining({ status: "pending" })],
      }),
    });
    expect(browser.storage.local.remove).toHaveBeenCalledWith("target-review");
  });

  it("allows an explicitly cancelled target to be retried after user review", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "cancelled",
        safeSignals: ["full-fiscal-year-target-cancelled"],
      }),
    });

    const recovery = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(recovery).toMatchObject({
      ok: true,
      ledger: {
        revision: 3,
        status: "running",
        targets: [expect.objectContaining({ period: "April", status: "pending" })],
      },
    });
  });

  it("discards a pending full-year resume without leaving a recoverable target", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "pending",
        safeSignals: ["full-fiscal-year-resume-confirmation-required"],
      }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "cancelled",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["full-fiscal-year-run-discarded", "full-fiscal-year-opfs-cleared"],
      },
      flowSummary: {
        status: "cancelled",
        currentPeriod: "April",
      },
    });
    expect(JSON.stringify(response)).not.toContain("fullFiscalYearRecovery");
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith("ledger-existing");
    expect(browser.storage.local.remove).toHaveBeenCalledWith("full-year-ledger");
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        status: "cancelled",
      }),
    });
  });

  it("discards a blocked full-year run without leaving the saved ledger", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "blocked",
        safeSignals: ["filed-return-result-row-not-found"],
      }),
      "target-review": {
        schemaVersion: "1.0",
        targetId: "GSTR-1:2025-26:May",
        status: "download-unconfirmed",
        scope: {
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
          artifactType: "PDF",
        },
        safeSignals: ["browser-download-size-unknown"],
        safeMessage: "Unrelated review.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "cancelled",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: ["full-fiscal-year-run-discarded", "full-fiscal-year-opfs-cleared"],
      },
    });
    expect(JSON.stringify(response)).not.toContain("fullFiscalYearRecovery");
    expect(browser.storage.local.remove).toHaveBeenCalledWith("full-year-ledger");
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("target-review");
  });

  it("keeps a manually observed full-year target recoverable for ZIP restaging", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({ revision: 2 }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "manually-observed",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: [
          "filed-returns-target-manually-observed",
          "full-fiscal-year-manual-observation-needs-restaging",
        ],
      },
      flowSummary: {
        status: "partial",
        completedPeriods: [],
        fullFiscalYearRecovery: {
          targetStatus: "manually-observed",
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("browser-confirmed");
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      "full-year-ledger": expect.objectContaining({
        targets: [expect.objectContaining({ status: "manually-observed" })],
      }),
    });
    expect(browser.storage.session.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        completedPeriods: [],
        fullFiscalYearRecovery: expect.objectContaining({
          targetStatus: "manually-observed",
        }),
      }),
    });
  });

  it("resets a manually observed target when the user retries ZIP staging", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "manually-observed",
        safeSignals: [
          "filed-returns-target-manually-observed",
          "full-fiscal-year-manual-observation-needs-restaging",
        ],
      }),
    });

    const recovery = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      recoveryDeps(),
    );

    expect(recovery).toMatchObject({
      ok: true,
      ledger: {
        status: "running",
        targets: [expect.objectContaining({ status: "pending" })],
      },
    });
  });

  it("retains the saved ledger when discard cannot clear staged files", async () => {
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockResolvedValueOnce(
      "full-fiscal-year-opfs-clear-failed",
    );
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "blocked",
        safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
      }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "cancelled",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-run-discard-cleanup-failed",
          "full-fiscal-year-opfs-retained",
        ]),
      },
      flowSummary: {
        fullFiscalYearRecovery: {
          targetStatus: "blocked",
        },
      },
    });
    expect(browser.storage.local.remove).not.toHaveBeenCalledWith("full-year-ledger");
  });

  it("rejects manual observation when the target has no final-click evidence", async () => {
    mockLocalStorageGet({
      "full-year-ledger": createRecoveryLedger({
        revision: 2,
        targetStatus: "blocked",
        safeSignals: ["filed-return-result-row-not-found"],
      }),
    });

    const response = await resolveFullFiscalYearTarget(
      {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
      },
      "manually-observed",
      recoveryDeps(),
    );

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["full-fiscal-year-manual-observation-unavailable"],
      },
    });
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.session.set).not.toHaveBeenCalled();
  });

  it("serializes concurrent recovery commands so only one matching revision can mutate", async () => {
    const store: Record<string, unknown> = {
      "full-year-ledger": createRecoveryLedger({ revision: 2 }),
    };
    vi.mocked(browser.storage.local.get).mockImplementation(async (key: unknown) => {
      if (typeof key === "string") return { [key]: store[key] };
      return store;
    });
    vi.mocked(browser.storage.local.set).mockImplementation(
      async (value: Record<string, unknown>) => {
        Object.assign(store, value);
      },
    );

    const payload = {
      ledgerId: "ledger-existing",
      targetId: "GSTR-3B:2026-27:April",
      expectedRevision: 2,
    };
    const [first, second] = await Promise.all([
      prepareFullFiscalYearTargetRetry(payload, recoveryDeps()),
      prepareFullFiscalYearTargetRetry(payload, recoveryDeps()),
    ]);

    expect(first).toMatchObject({
      ok: true,
      ledger: {
        revision: 3,
        targets: [expect.objectContaining({ status: "pending" })],
      },
    });
    expect(second).toMatchObject({
      ok: false,
      response: {
        flowStep: {
          safeSignals: ["full-fiscal-year-recovery-stale"],
        },
      },
    });
    expect(browser.storage.local.set).toHaveBeenCalledTimes(1);
  });
});

function recoveryDeps() {
  return {
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "full-year-ledger",
      targetReview: "target-review",
    },
    now: () => new Date("2026-06-24T00:00:00.000Z"),
  };
}

function mockLocalStorageGet(values: Record<string, unknown>) {
  vi.mocked(browser.storage.local.get).mockImplementation(async (key: unknown) => {
    if (typeof key === "string") return { [key]: values[key] };
    return values;
  });
}

function createRecoveryLedger({
  revision,
  targetStatus = "download-unconfirmed",
  safeSignals = ["browser-download-size-unknown"],
}: {
  revision: number;
  targetStatus?: FiledReturnsFullFiscalYearLedger["targets"][number]["status"];
  safeSignals?: string[];
}): FiledReturnsFullFiscalYearLedger {
  return {
    schemaVersion: "1.0",
    ledgerId: "ledger-existing",
    revision,
    status: "blocked",
    scope: {
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    currentTargetId: "GSTR-3B:2026-27:April",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    targets: [
      {
        targetId: "GSTR-3B:2026-27:April",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-3B",
        status: targetStatus,
        attempts: 1,
        safeSignals,
        safeMessage: "Unconfirmed.",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    ],
  };
}

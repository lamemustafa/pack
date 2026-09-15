import { beforeEach, describe, expect, it, vi } from "vitest";
import { retryAllSupportedFiledReturnsFullFiscalYearTarget } from "../../src/background/filed-returns-flow-runner";
import {
  createAllSupportedFullFiscalYearLedger,
  markAllSupportedFullFiscalYearTargetRunning,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-ledger";
import { persistAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-run-state";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";

const NOW = new Date("2026-07-15T00:00:00.000Z");

const stored = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: stored.values[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(stored.values, obj);
        }),
        remove: vi.fn(async (key: string) => {
          delete stored.values[key];
        }),
      },
    },
    downloads: { search: vi.fn(async () => []) },
  },
}));

const request = {
  kind: "all-supported-returns-full-fiscal-year" as const,
  financialYear: "2026-27",
};

function deps() {
  return {
    getActiveGstTab: vi.fn(async () => null),
    sendMessageToTabWithInjection: vi.fn(),
    storageKeys: {
      activeRun: "active-run",
      allSupportedFullFiscalYearLedgerIndex: "all-supported-index",
      completion: "completion",
      fullFiscalYearLedger: "full-fiscal-year-ledger",
      observation: "observation",
    },
    now: () => NOW,
  } as any;
}

beforeEach(() => {
  stored.values = {};
});

describe("scratch: retry wrapper vs inner interrupted derivation", () => {
  it("investigates the scenario where activeRun key is MISSING (worker died before ever setting it, or was cleared)", async () => {
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected plan");
    const first = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      NOW,
    );
    const interrupted = markAllSupportedFullFiscalYearTargetRunning(
      first,
      first.targets[0]!.targetId,
      NOW,
    );
    const d = deps();
    await persistAllSupportedFullFiscalYearLedger(d, interrupted);

    const response = await retryAllSupportedFiledReturnsFullFiscalYearTarget(
      {
        financialYear: request.financialYear,
        ledgerId: interrupted.ledgerId,
        targetId: interrupted.targets[0]!.targetId,
        expectedRevision: interrupted.revision,
      },
      d,
    );
    console.log("RESPONSE with missing activeRun key:", JSON.stringify(response, null, 2));
    console.log("STORED activeRun after call:", JSON.stringify(stored.values["active-run"]));
  });

  it("investigates the scenario where activeRun key is STALE (left behind by the dead worker)", async () => {
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected plan");
    const first = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      NOW,
    );
    const interrupted = markAllSupportedFullFiscalYearTargetRunning(
      first,
      first.targets[0]!.targetId,
      NOW,
    );
    const d = deps();
    await persistAllSupportedFullFiscalYearLedger(d, interrupted);
    stored.values["active-run"] = {
      schemaVersion: "1.0",
      runId: "filed-returns-run-m0abc123",
      revision: 1,
      scope: {
        artifactType: "PDF",
        financialYear: request.financialYear,
        period: "April",
        returnType: "GSTR-3B",
      },
      status: "running",
      leaseUpdatedAt: new Date(NOW.getTime() - 120_000).toISOString(),
    };

    const response = await retryAllSupportedFiledReturnsFullFiscalYearTarget(
      {
        financialYear: request.financialYear,
        ledgerId: interrupted.ledgerId,
        targetId: interrupted.targets[0]!.targetId,
        expectedRevision: interrupted.revision,
      },
      d,
    );
    console.log("RESPONSE with stale activeRun key:", JSON.stringify(response, null, 2));
  });
});

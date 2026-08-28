import { beforeEach, expect, it, vi } from "vitest";
import {
  startFullFiscalYearDownloadFlow,
  type SinglePeriodRunner,
} from "../../src/background/filed-returns-full-fiscal-year";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";

const mocks = vi.hoisted(() => {
  const values: Record<string, unknown> = {};
  return {
    values,
    set: vi.fn(async (next: Record<string, unknown>) => {
      Object.assign(values, structuredClone(next));
    }),
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
  };
});
vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async () => structuredClone(mocks.values)),
        set: mocks.set,
        remove: vi.fn(async () => undefined),
      },
      session: mocks.session,
    },
  },
}));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => ({
  discardFullFiscalYearFiledReturnsZip: vi.fn(async () => ["full-fiscal-year-opfs-cleared"]),
  exportFullFiscalYearZip: vi.fn(async () => ({
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "downloaded",
    safeSignals: ["full-fiscal-year-no-zip-artifacts"],
    safeMessage: "Synthetic no-export outcome.",
  })),
}));
const scope = {
  artifactType: "PDF",
  financialYear: "2026-27",
  period: FULL_FISCAL_YEAR_PERIOD,
  returnType: "GSTR-3B",
} as const;
const deps: FiledReturnsFlowRunnerDeps = {
  getActiveGstTab: vi.fn(async () => null),
  sendMessageToTabWithInjection: vi.fn(),
  storageKeys: {
    completion: "completion",
    fullFiscalYearLedger: "ledger",
    observation: "observation",
  },
  now: () => new Date("2026-07-15T00:00:00.000Z"),
};
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.values)) delete mocks.values[key];
  mocks.set.mockImplementation(async (next) => {
    Object.assign(mocks.values, structuredClone(next));
  });
});

it("persists the first tab pin before work and requires it for every later planned target", async () => {
  const pins: (number | undefined)[] = [];
  const runner = vi.fn<SinglePeriodRunner>(async (_scope, _deps, options) => {
    pins.push(options?.requiredPortalTabId);
    await options?.onPortalTabSelected?.(41, "synthetic-pinned-session");
    const saved = mocks.values.ledger;
    expect(isFullFiscalYearLedger(saved)).toBe(true);
    if (!isFullFiscalYearLedger(saved)) throw new Error("expected persisted plan before work");
    expect(saved.portalTabId, "plan pin must be durable before a target acts").toBe(41);
    expect(saved.portalTabSessionId).toBe("synthetic-pinned-session");
    if (pins.length > 1)
      expect(options?.requiredPortalTabSessionId).toBe("synthetic-pinned-session");
    return {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "candidate-not-found",
        safeSignals: ["filed-return-positively-not-filed"],
        safeMessage: "Synthetic not-filed result.",
      },
    };
  });
  const response = await startFullFiscalYearDownloadFlow(scope, deps, runner);
  expect(response).toMatchObject({ flowSummary: { status: "complete", totalPeriods: 3 } });
  expect(pins, "later targets must keep the original tab, not the active tab").toEqual([
    undefined,
    41,
    41,
  ]);
  expect(deps.getActiveGstTab).not.toHaveBeenCalled();
});

it("performs no target work when the original tab pin cannot be persisted", async () => {
  const targetWork = vi.fn();
  mocks.set.mockImplementation(async (next) => {
    if (
      Object.values(next).some(
        (value) => isFullFiscalYearLedger(value) && value.portalTabId !== undefined,
      )
    )
      throw new Error("synthetic pin write refusal");
    Object.assign(mocks.values, structuredClone(next));
  });
  const runner = vi.fn<SinglePeriodRunner>(async (_scope, _deps, options) => {
    await options?.onPortalTabSelected?.(41, "synthetic-pinned-session");
    targetWork();
    return { ok: false, error: "unreachable synthetic target" };
  });
  await expect(startFullFiscalYearDownloadFlow(scope, deps, runner)).rejects.toThrow(
    "synthetic pin write refusal",
  );
  expect(targetWork).not.toHaveBeenCalled();
  expect(deps.sendMessageToTabWithInjection).not.toHaveBeenCalled();
});

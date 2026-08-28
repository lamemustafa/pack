import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (key?: unknown) => {
        if (typeof key === "string") return { [key]: stored.current[key] };
        return stored.current;
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete stored.current[key];
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(stored.current, values);
      }),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

import {
  clearLedgerPlans,
  filedReturnsPlanStorageKey,
  readPlanLedgersStorageState,
} from "../../src/background/filed-returns-full-fiscal-year-run-state";

const deps = {
  storageKeys: { fullFiscalYearLedger: "legacy", fullFiscalYearLedgerIndex: "index" },
};

describe("plan record storage", () => {
  beforeEach(() => {
    stored.current = {};
    vi.clearAllMocks();
  });

  it("erases every plan record the reader can see, not a stricter subset", async () => {
    // An id outside the eraser's old [a-z0-9-] charset. Nothing constructs one
    // today; the point is that the eraser must not be narrower than the finder,
    // because on this path the narrow side leaks a plan record past a clear.
    const awkward = filedReturnsPlanStorageKey("full-fiscal-year_00000001");
    stored.current = {
      index: { schemaVersion: "1.0", ledgerIdsByScope: { key: "full-fiscal-year_00000001" } },
      [awkward]: { ledgerId: "full-fiscal-year_00000001" },
      unrelated: { keep: true },
    };

    // The finder sees it, so a clear that leaves it behind is a disagreement
    // between two predicates for the same fact.
    expect(await readPlanLedgersStorageState(deps)).toEqual({ state: "malformed" });

    await clearLedgerPlans(deps);

    expect(Object.keys(stored.current)).toEqual(["unrelated"]);
  });

  it("leaves storage untouched when no plan index is configured", async () => {
    stored.current = { [filedReturnsPlanStorageKey("full-fiscal-year-00000002")]: {} };

    await clearLedgerPlans({ storageKeys: { fullFiscalYearLedger: "legacy" } });

    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });
});

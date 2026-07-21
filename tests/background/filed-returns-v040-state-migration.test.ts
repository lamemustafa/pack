import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasLegacyFiledReturnsStateRequiringReview,
  migrateV040FiledReturnsState,
} from "../../src/background/filed-returns-v040-state-migration";

const store = vi.hoisted(() => new Map<string, unknown>());
const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const requestedKeys = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          requestedKeys.filter((key) => store.has(key)).map((key) => [key, store.get(key)]),
        );
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) store.set(key, value);
      }),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

const storageKeys = {
  activeRun: "active-run",
  fullFiscalYearLedger: "full-fiscal-year-ledger",
  singlePeriodStaging: "single-period-staging",
  stateMigration: "state-migration",
  storageQuarantine: "storage-quarantine",
  targetReview: "target-review",
};

describe("v0.4 filed returns state migration", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("records a clean v0.4 migration when no legacy work remains", async () => {
    const outcome = await migrateV040FiledReturnsState({
      installedVersion: "0.4.0",
      storageKeys,
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    });

    expect(outcome).toBe("clean");
    expect(store.get(storageKeys.stateMigration)).toEqual({
      schemaVersion: "1.0",
      source: "v0.4.x",
      state: "clean",
      updatedAt: "2026-07-21T00:00:00.000Z",
      quarantinedKeys: [],
    });
  });

  it("quarantines legacy run state without preserving its contents or resuming it", async () => {
    store.set(storageKeys.activeRun, { unsafe: "forbidden-metadata" });
    store.set(storageKeys.targetReview, { unsafe: "forbidden-metadata" });

    const outcome = await migrateV040FiledReturnsState({
      installedVersion: "0.4.0",
      storageKeys,
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    });

    expect(outcome).toBe("quarantined");
    expect(store.has(storageKeys.activeRun)).toBe(false);
    expect(store.has(storageKeys.targetReview)).toBe(false);
    expect(await hasLegacyFiledReturnsStateRequiringReview(storageKeys.stateMigration)).toBe(true);

    const serializedStore = JSON.stringify(Object.fromEntries(store.entries()));
    expect(serializedStore).not.toContain("forbidden-metadata");
    expect(serializedStore).toContain("active-run");
    expect(serializedStore).toContain("target-review");
  });

  it("finishes a pending quarantine even after the install version advances", async () => {
    store.set(storageKeys.activeRun, { unsafe: "forbidden-metadata" });
    store.set(storageKeys.stateMigration, {
      schemaVersion: "1.0",
      source: "v0.4.x",
      state: "quarantine-pending",
      updatedAt: "2026-07-21T00:00:00.000Z",
      quarantinedKeys: ["active-run"],
    });

    const outcome = await migrateV040FiledReturnsState({
      installedVersion: "0.5.0",
      storageKeys,
      now: () => new Date("2026-07-21T00:01:00.000Z"),
    });

    expect(outcome).toBe("quarantined");
    expect(store.has(storageKeys.activeRun)).toBe(false);
    expect(await hasLegacyFiledReturnsStateRequiringReview(storageKeys.stateMigration)).toBe(true);
  });

  it("does not touch v0.5 state that is outside this migration contract", async () => {
    const outcome = await migrateV040FiledReturnsState({
      installedVersion: "0.5.0",
      storageKeys,
    });

    expect(outcome).toBe("not-applicable");
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });
});

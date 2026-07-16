import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSinglePeriodStagingRecord,
  reserveSinglePeriodBundleLedger,
} from "../../src/background/filed-returns-artifact-progress";

const state = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
}));

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: state.local[key] })),
      remove: vi.fn(async (key: string) => {
        delete state.local[key];
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(state.local, values);
      }),
    },
  },
}));

const offscreenMocks = vi.hoisted(() => ({
  clearOffscreenFiledReturnLedger: vi.fn<() => Promise<"cleared" | "failed">>(
    async () => "cleared",
  ),
  closeOffscreenBlobDocument: vi.fn(async () => undefined),
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));
vi.mock("../../src/background/offscreen-blob-url", () => offscreenMocks);

describe("single-period filed-return staging ownership", () => {
  beforeEach(() => {
    state.local = {};
    vi.clearAllMocks();
    offscreenMocks.clearOffscreenFiledReturnLedger.mockResolvedValue("cleared");
  });

  it("persists an opaque cleanup identity before returning a ledger id", async () => {
    const ledgerId = await reserveSinglePeriodBundleLedger();

    expect(ledgerId).toMatch(/^single-period:[a-zA-Z0-9._-]+$/);
    expect(state.local["pack:single-period-staging"]).toEqual({
      ledgerId,
      schemaVersion: "1.0",
    });
    expect(ledgerId).not.toContain("GSTR");
    expect(ledgerId).not.toContain("202");
  });

  it("preserves retained staging instead of repeating portal artifacts after restart", async () => {
    state.local["pack:single-period-staging"] = {
      ledgerId: "single-period:abandoned",
      schemaVersion: "1.0",
    };

    const ledgerId = await reserveSinglePeriodBundleLedger();

    expect(ledgerId).toBeNull();
    expect(offscreenMocks.clearOffscreenFiledReturnLedger).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(state.local["pack:single-period-staging"]).toEqual({
      ledgerId: "single-period:abandoned",
      schemaVersion: "1.0",
    });
  });

  it("does not let cleanup availability change retained staging ownership", async () => {
    state.local["pack:single-period-staging"] = {
      ledgerId: "single-period:abandoned",
      schemaVersion: "1.0",
    };
    offscreenMocks.clearOffscreenFiledReturnLedger.mockResolvedValue("failed");

    const ledgerId = await reserveSinglePeriodBundleLedger();

    expect(ledgerId).toBeNull();
    expect(offscreenMocks.clearOffscreenFiledReturnLedger).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    expect(state.local["pack:single-period-staging"]).toEqual({
      ledgerId: "single-period:abandoned",
      schemaVersion: "1.0",
    });
  });

  it("fails closed when durable staging ownership cannot be read", async () => {
    browserMocks.storage.local.get.mockRejectedValueOnce(new Error("synthetic storage failure"));

    await expect(reserveSinglePeriodBundleLedger()).resolves.toBeNull();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("fails closed when durable staging ownership is malformed", async () => {
    state.local["pack:single-period-staging"] = { schemaVersion: "unexpected" };

    await expect(reserveSinglePeriodBundleLedger()).resolves.toBeNull();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("fails closed when a current-schema staging id is not Pack-owned", async () => {
    state.local["pack:single-period-staging"] = {
      ledgerId: "untrusted-ledger",
      schemaVersion: "1.0",
    };

    await expect(reserveSinglePeriodBundleLedger()).resolves.toBeNull();
    expect(offscreenMocks.clearOffscreenFiledReturnLedger).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("removes only the record owned by the cleared ledger", async () => {
    state.local["pack:single-period-staging"] = {
      ledgerId: "single-period:current",
      schemaVersion: "1.0",
    };

    await clearSinglePeriodStagingRecord("single-period:other");
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();

    await clearSinglePeriodStagingRecord("single-period:current");
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("pack:single-period-staging");
  });
});

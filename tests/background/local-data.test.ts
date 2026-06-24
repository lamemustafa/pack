import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  downloads: {
    download: vi.fn(async () => 1),
  },
  runtime: {
    id: "pack-test-extension",
    getManifest: vi.fn(() => ({ version: "0.1.0" })),
    onInstalled: {
      addListener: vi.fn(),
    },
    onMessage: {
      addListener: vi.fn(),
    },
  },
  scripting: {
    executeScript: vi.fn(async () => []),
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      setAccessLevel: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    session: {
      clear: vi.fn(async () => undefined),
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
  tabs: {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));

describe("Pack local data clearing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubGlobal("defineBackground", (entrypoint: () => void) => {
      entrypoint();
      return entrypoint;
    });
  });

  it("removes every Pack local storage key and clears session storage", async () => {
    const background = await import("../../src/entrypoints/background");

    await background.clearPackLocalData();

    expect(browserMocks.storage.session.clear).toHaveBeenCalledTimes(1);
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
    expect(background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS).toEqual(
      Object.values(background.PACK_LOCAL_STORAGE_KEYS),
    );
  });

  it("restricts local storage to trusted extension contexts on startup", async () => {
    await import("../../src/entrypoints/background");

    expect(browserMocks.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });
});

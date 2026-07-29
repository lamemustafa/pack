import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FilenameDeterminationListener } from "../../src/background/pack-download-filename-reassertion";

const mocks = vi.hoisted(() => {
  let filenameListener: FilenameDeterminationListener | null = null;
  const suggestions: Array<string | undefined> = [];
  return {
    downloads: {
      download: vi.fn(async ({ url }: { url: string }) => {
        filenameListener?.({ id: 71, url }, (suggestion) => suggestions.push(suggestion?.filename));
        return 71;
      }),
      onDeterminingFilename: {
        addListener: vi.fn((listener: FilenameDeterminationListener) => {
          filenameListener = listener;
        }),
      },
    },
    reset() {
      filenameListener = null;
      suggestions.length = 0;
    },
    runtime: { getManifest: vi.fn(() => ({ version: "0.3.3" })) },
    storage: { local: { set: vi.fn(async () => undefined) } },
    suggestions,
  };
});

vi.mock("wxt/browser", () => ({
  browser: {
    downloads: mocks.downloads,
    runtime: mocks.runtime,
    storage: mocks.storage,
  },
}));

describe("synthetic demo filename reassertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.reset();
  });

  it("suggests the Pack-Demo path observed by the browser listener", async () => {
    const { startSyntheticDemo } = await import("../../src/background/synthetic-demo");

    const response = await startSyntheticDemo({
      downloadArtifacts: true,
      officialUrl: "https://pack.example.test",
      productVersion: "0.3.3-test",
      storageKeys: { lastManifest: "pack:test-manifest" },
    });

    expect(response).toMatchObject({ ok: true, downloaded: 10 });
    expect(mocks.suggestions).toHaveLength(10);
    expect(mocks.suggestions.every((filename) => filename?.startsWith("Pack-Demo/"))).toBe(true);
  });
});

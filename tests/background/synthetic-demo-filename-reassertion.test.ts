import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FilenameDeterminationListener } from "../../src/background/pack-download-filename-reassertion";

// Chrome fires `onDeterminingFilename` independently of the `downloads.download()` promise, and
// routinely *after* it resolves. The previous fixture called the listener synchronously inside the
// `download()` mock, so the reservation was always still live when it ran and the test passed
// whether or not the reservation outlived the promise -- the ordering that actually breaks was the
// one it could not produce. #314 named this; it is the shape Pack's review history flags most
// often at P1, a fixture encoding an assumed sequence rather than an observed one.
//
// `deferDetermination` reproduces the observed ordering. `immediateDetermination` keeps the old
// one, because both occur and neither may regress.
const mocks = vi.hoisted(() => {
  let filenameListener: FilenameDeterminationListener | null = null;
  let mode: "deferred" | "immediate" = "deferred";
  const suggestions: Array<string | undefined> = [];
  let nextId = 71;

  function fire(id: number, url: string) {
    filenameListener?.({ id, url }, (suggestion) => suggestions.push(suggestion?.filename));
  }

  return {
    downloads: {
      download: vi.fn(async ({ url }: { url: string }) => {
        const id = nextId++;
        if (mode === "immediate") {
          fire(id, url);
          return id;
        }
        // Resolve first, then fire on a later turn — what Chrome does.
        queueMicrotask(() => setTimeout(() => fire(id, url), 0));
        return id;
      }),
      onDeterminingFilename: {
        addListener: vi.fn((listener: FilenameDeterminationListener) => {
          filenameListener = listener;
        }),
      },
    },
    reset(next: "deferred" | "immediate" = "deferred") {
      filenameListener = null;
      suggestions.length = 0;
      nextId = 71;
      mode = next;
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

async function runDemo() {
  const { startSyntheticDemo } = await import("../../src/background/synthetic-demo");
  return startSyntheticDemo({
    downloadArtifacts: true,
    officialUrl: "https://pack.example.test",
    productVersion: "0.3.3-test",
    storageKeys: { lastManifest: "pack:test-manifest" },
  });
}

describe("synthetic demo filename reassertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.reset();
  });

  it("re-asserts the Pack-Demo path when determination arrives after the download resolves", async () => {
    const response = await runDemo();

    expect(response).toMatchObject({ ok: true, downloaded: 10 });
    // The observable outcome: the browser was told the requested name for every file. Asserting
    // only the response would pass with every reservation already released.
    expect(mocks.suggestions).toHaveLength(10);
    expect(mocks.suggestions.every((filename) => filename?.startsWith("Pack-Demo/"))).toBe(true);
  });

  it("still re-asserts when determination arrives before the download resolves", async () => {
    mocks.reset("immediate");
    const response = await runDemo();

    expect(response).toMatchObject({ ok: true, downloaded: 10 });
    expect(mocks.suggestions).toHaveLength(10);
    expect(mocks.suggestions.every((filename) => filename?.startsWith("Pack-Demo/"))).toBe(true);
  });
});

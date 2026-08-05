import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { MAX_ARTIFACT_BYTES } from "../../src/connectors/gst/artifact-validation";

const mocks = vi.hoisted(() => ({
  downloadAcquiredArtifact: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: { scripting: { executeScript: vi.fn() } },
}));
vi.mock("../../src/background/artifact-download", () => ({
  downloadAcquiredArtifact: mocks.downloadAcquiredArtifact,
}));

import { acquireFiledReturnJsonInMainWorld } from "../../src/background/filed-returns-json-acquisition";

function base64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("filed-return JSON main-world acquisition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps portal JSON bytes inside the service-worker-owned MAIN-world result", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValue([
      {
        result: {
          ok: true,
          base64: base64Json({
            status: 1,
            data: { r3b: { ret_period: "062026" }, padding: "x".repeat(100) },
          }),
        },
      },
    ] as never);
    mocks.downloadAcquiredArtifact.mockResolvedValue({
      bytesReceived: 128,
      downloadId: 91,
      ok: true,
      safeSignals: ["synthetic"],
    });

    await expect(
      acquireFiledReturnJsonInMainWorld({
        filename: "ComplyEaze-Pack/2026-27/GSTR-3B/June-data.json",
        requestId: "synthetic-request",
        returnPeriod: "062026",
        returnType: "GSTR-3B",
        tabId: 17,
      }),
    ).resolves.toEqual({
      downloadId: 91,
      ok: true,
      safeSignals: ["synthetic"],
    });

    expect(browser.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          {
            maxArtifactBytes: MAX_ARTIFACT_BYTES,
            returnPeriod: "062026",
            returnType: "GSTR-3B",
          },
        ],
        target: { tabId: 17 },
        world: "MAIN",
      }),
    );
    expect(mocks.downloadAcquiredArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "ComplyEaze-Pack/2026-27/GSTR-3B/June-data.json",
        mimeType: "application/json",
      }),
    );

    const [injection] = vi.mocked(browser.scripting.executeScript).mock.calls[0] ?? [];
    const mainWorldInjection = injection as unknown as {
      args: [{ maxArtifactBytes: number; returnPeriod: string; returnType: "GSTR-3B" | "GSTR-2B" }];
      func: (input: {
        maxArtifactBytes: number;
        returnPeriod: string;
        returnType: "GSTR-3B" | "GSTR-2B";
      }) => Promise<unknown>;
    };
    const executeMainWorld = mainWorldInjection.func as (input: {
      maxArtifactBytes: number;
      returnPeriod: string;
      returnType: "GSTR-3B" | "GSTR-2B";
    }) => Promise<unknown>;
    const rebuiltMainWorldFunction = new Function(
      `"use strict"; return (${executeMainWorld.toString()});`,
    )() as typeof executeMainWorld;
    const [mainWorldInput] = mainWorldInjection.args;
    const encode = vi.fn();
    vi.stubGlobal("btoa", encode);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(MAX_ARTIFACT_BYTES + 1))),
    );
    vi.stubGlobal("location", { origin: "https://return.gst.gov.in" });
    try {
      await expect(rebuiltMainWorldFunction(mainWorldInput)).resolves.toEqual({
        ok: false,
        reason: "too-large",
      });
      expect(encode).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed when the worker receives JSON for another return period", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValue([
      {
        result: {
          ok: true,
          base64: base64Json({
            status: 1,
            data: { r3b: { ret_period: "052026" }, padding: "x".repeat(100) },
          }),
        },
      },
    ] as never);

    await expect(
      acquireFiledReturnJsonInMainWorld({
        filename: "synthetic.json",
        requestId: "synthetic-request",
        returnPeriod: "062026",
        returnType: "GSTR-3B",
        tabId: 17,
      }),
    ).resolves.toEqual({ ok: false, reason: "target-period-mismatch", safeSignals: [] });
    expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
  });

  it.each(["missing result", "rejected execution"])(
    "reports %s as a MAIN-world execution failure rather than an endpoint failure",
    async (scenario) => {
      if (scenario === "missing result")
        vi.mocked(browser.scripting.executeScript).mockResolvedValue([] as never);
      else
        vi.mocked(browser.scripting.executeScript).mockRejectedValue(
          new Error("synthetic rejection"),
        );

      await expect(
        acquireFiledReturnJsonInMainWorld({
          filename: "synthetic.json",
          requestId: "main-world-failure",
          returnPeriod: "062026",
          returnType: "GSTR-3B",
          tabId: 17,
        }),
      ).resolves.toEqual({ ok: false, reason: "main-world-execution-failed", safeSignals: [] });
      expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
    },
  );

  it("hands validated JSON to a worker-owned local stager when one is supplied", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValue([
      {
        result: {
          ok: true,
          base64: base64Json({
            data: { rtnprd: "062026", padding: "x".repeat(100) },
            status: 1,
          }),
        },
      },
    ] as never);
    const deliver = vi.fn(async () => ({
      ok: true as const,
      safeSignals: ["single-period-opfs-staged"],
    }));

    await expect(
      acquireFiledReturnJsonInMainWorld({
        deliver,
        filename: "synthetic.json",
        requestId: "synthetic-request",
        returnPeriod: "062026",
        returnType: "GSTR-2B",
        tabId: 17,
      }),
    ).resolves.toEqual({ ok: true, safeSignals: ["single-period-opfs-staged"] });

    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "application/json" }));
    expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
  });

  it("returns a terminal safe failure when worker-owned local staging rejects", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValue([
      {
        result: {
          ok: true,
          base64: base64Json({
            data: { rtnprd: "062026", padding: "x".repeat(100) },
            status: 1,
          }),
        },
      },
    ] as never);
    const deliver = vi.fn(async () => {
      throw new Error("synthetic local staging rejection");
    });

    await expect(
      acquireFiledReturnJsonInMainWorld({
        deliver,
        filename: "synthetic.json",
        requestId: "synthetic-request",
        returnPeriod: "062026",
        returnType: "GSTR-2B",
        tabId: 17,
      }),
    ).resolves.toEqual({ ok: false, reason: "delivery-unconfirmed", safeSignals: [] });

    expect(mocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
  });

  it("returns a terminal safe failure when direct offscreen delivery rejects", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValue([
      {
        result: {
          ok: true,
          base64: base64Json({
            data: { rtnprd: "062026", padding: "x".repeat(100) },
            status: 1,
          }),
        },
      },
    ] as never);
    mocks.downloadAcquiredArtifact.mockRejectedValueOnce(
      new Error("synthetic offscreen delivery rejection"),
    );

    await expect(
      acquireFiledReturnJsonInMainWorld({
        filename: "synthetic.json",
        requestId: "synthetic-request",
        returnPeriod: "062026",
        returnType: "GSTR-2B",
        tabId: 17,
      }),
    ).resolves.toEqual({ ok: false, reason: "delivery-unconfirmed", safeSignals: [] });
  });
});

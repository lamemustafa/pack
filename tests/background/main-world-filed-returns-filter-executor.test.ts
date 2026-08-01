import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { selectFiledReturnsFiltersInMainWorldForTab } from "../../src/background/main-world-filed-returns-filter-executor";
import { CLICKABLE_CONTROL_SELECTOR } from "../../src/connectors/gst/filed-returns-dom";

vi.mock("wxt/browser", () => ({
  browser: {
    scripting: {
      executeScript: vi.fn(),
    },
  },
}));

describe("main-world filed-return filter executor", () => {
  it("requires a serialization guard for every MAIN-world injected function", async () => {
    const files = (await readdir("src", { recursive: true })).filter(
      (file): file is string => typeof file === "string" && file.endsWith(".ts"),
    );
    const functions = (
      await Promise.all(files.map((file) => readFile(`src/${file}`, "utf8")))
    ).flatMap((source) =>
      Array.from(source.matchAll(/func:\s*(\w+),\s*target:[\s\S]{0,120}?world:\s*"MAIN"/g)).map(
        ([, func]) => func,
      ),
    );

    expect(functions.sort()).toEqual([
      "capturePortalPdfBlob",
      "capturePortalPdfBlob",
      "fetchFiledReturnJsonInMainWorld",
      "selectFiledReturnsFiltersInMainWorld",
    ]);
  });

  it("returns only the validated control-state outcome from the page", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValue([
      {
        result: {
          state: "searched",
          safeSignals: ["main-world-search-clicked"],
        },
      },
    ] as never);

    await expect(
      selectFiledReturnsFiltersInMainWorldForTab(17, {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      }),
    ).resolves.toEqual({
      state: "searched",
      safeSignals: ["main-world-search-clicked"],
    });
    expect(browser.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          {
            financialYear: "2026-27",
            period: "May",
            returnType: "GSTR-3B",
          },
          CLICKABLE_CONTROL_SELECTOR,
        ],
        target: { tabId: 17 },
        world: "MAIN",
      }),
    );
  });

  it("fails closed when page execution returns an invalid outcome", async () => {
    vi.mocked(browser.scripting.executeScript).mockResolvedValue([
      { result: { state: "searched" } },
    ] as never);

    await expect(
      selectFiledReturnsFiltersInMainWorldForTab(17, {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      }),
    ).resolves.toEqual({
      state: "unavailable",
      safeSignals: ["main-world-filter-execution-unavailable"],
    });
  });
});

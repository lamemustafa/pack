import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { selectFiledReturnsFiltersInMainWorldForTab } from "../../src/background/main-world-filed-returns-filter-executor";

vi.mock("wxt/browser", () => ({
  browser: {
    scripting: {
      executeScript: vi.fn(),
    },
  },
}));

describe("main-world filed-return filter executor", () => {
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

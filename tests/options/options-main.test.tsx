// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("wxt/browser", () => ({ browser: { runtime: { sendMessage: mocks.sendMessage } } }));

import { OptionsPage } from "../../src/entrypoints/options/main";

describe("options local-data failure presentation", () => {
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = "<div id='test-root'></div>";
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.sendMessage.mockRejectedValue(new Error("worker unavailable"));
    root = createRoot(document.getElementById("test-root") as HTMLElement);
    await act(async () => {
      root.render(<OptionsPage />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("announces options action status to assistive technology", () => {
    expect(document.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps a rejected local-data clear request visible", async () => {
    const clearButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Clear local data and discard saved plans",
    );
    if (!clearButton) throw new Error("Expected the local-data clear action.");

    await act(async () => {
      clearButton.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Pack could not clear local data. Try again.");
    expect(mocks.sendMessage).toHaveBeenCalledWith({ type: "PACK_CLEAR_LOCAL_DATA" });
  });

  it.each([
    ["Probe data URL download", "Pack could not start the synthetic download probe. Try again."],
    [
      "Last synthetic demo manifest",
      "Pack could not load the last synthetic demo manifest. Try again.",
    ],
  ])("keeps a rejected %s request visible", async (label, expectedStatus) => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) throw new Error(`Expected the ${label} action.`);

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(expectedStatus);
  });
});

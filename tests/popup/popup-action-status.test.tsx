import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PopupActionStatus } from "../../src/entrypoints/popup/popup-action-status";

describe("PopupActionStatus", () => {
  it("hides normal context confirmation", () => {
    expect(
      renderToStaticMarkup(createElement(PopupActionStatus, { message: "GST context detected." })),
    ).toBe("");
  });

  it("shows a safe action failure inline", () => {
    const markup = renderToStaticMarkup(
      createElement(PopupActionStatus, {
        message:
          "Pack could not complete this local browser action. Reload the extension and try again.",
      }),
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Reload the extension and try again.");
  });
});

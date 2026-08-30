import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));

import { PanelGuidedScope } from "../../src/entrypoints/panel/panel-guided-scope";
import { filedReturnsCapabilityRunNotes } from "../../src/connectors/gst/filed-returns-capabilities";
import { PANEL_TEST_SCOPE } from "./panel-controller.test-helpers";

/**
 * Capability notes say what a portal offers -- "Includes Excel only when the portal provides
 * it" -- which is a fact a reader needs, not a problem to fix. They rendered through
 * `panel-preset-reason`, the class a *disabled* reason uses, which paints them in
 * `--pack-warning-fg`; two of the three recipes therefore looked like they were carrying
 * warnings before anyone had chosen anything. The note stays, the warning colour does not.
 */

let dom: JSDOM;
let root: Root | null = null;
let container: Element;

function render() {
  root = createRoot(container);
  return act(async () => {
    root?.render(
      <PanelGuidedScope
        busy={null}
        context={{ connectorId: "gst", pageKind: "gst-filed-returns", supported: true }}
        externalBlock={null}
        flowSummary={null}
        portalSignedIn
        savedRun={null}
        scope={PANEL_TEST_SCOPE}
        scopeLockedForReview={false}
        onScopeChange={() => undefined}
        onStart={() => undefined}
      />,
    );
    await Promise.resolve();
  });
}

describe("preset cards", () => {
  beforeEach(() => {
    // The recipe cards exist only in the alpha surface; without this the component renders no
    // cards at all and every assertion below passes without touching what it claims to guard.
    vi.stubEnv("MODE", "alpha");
    dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true, url: "https://x.test" });
    Object.assign(globalThis, { document: dom.window.document, window: dom.window });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.getElementById("root") as Element;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    vi.unstubAllEnvs();
  });

  it("render the capability notes without the warning styling a disabled reason uses", async () => {
    await render();

    // Read the notes from the catalogue rather than restating them, so this keeps holding if
    // their wording changes.
    const notes = [
      ...filedReturnsCapabilityRunNotes("GSTR-1", "PDF_AND_EXCEL"),
      ...filedReturnsCapabilityRunNotes("GSTR-2B", "PDF_AND_EXCEL"),
    ];
    expect(notes.length).toBeGreaterThan(0);

    // Guard the precondition: if no card rendered, everything below would be vacuous.
    expect(container.querySelectorAll(".panel-preset-note").length).toBe(notes.length);

    const warningText = [...container.querySelectorAll(".panel-preset-reason")]
      .map((node) => node.textContent ?? "")
      .join("\n");
    for (const note of notes) {
      expect(container.textContent).toContain(note);
      expect(warningText).not.toContain(note);
    }
  });
});

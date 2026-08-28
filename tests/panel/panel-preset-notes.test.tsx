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
 * it" -- which is a fact, not a problem. On the recipe cards they rendered through
 * `panel-preset-reason`, the class a disabled reason uses, so two of the three recipes looked
 * like they were carrying warnings before anyone had chosen anything. They belong where a
 * format is being chosen, and `scope-form-model` still carries them there.
 */

let dom: JSDOM;
let root: Root | null = null;
let container: Element;

describe("preset cards", () => {
  beforeEach(() => {
    dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true, url: "https://x.test" });
    Object.assign(globalThis, { document: dom.window.document, window: dom.window });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.getElementById("root") as Element;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
  });

  it("do not carry capability notes as if they were warnings", async () => {
    root = createRoot(container);
    await act(async () => {
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

    // Read the notes from the catalogue rather than restating them, so this keeps holding if
    // their wording changes.
    const notes = [
      ...filedReturnsCapabilityRunNotes("GSTR-1", "PDF_AND_EXCEL"),
      ...filedReturnsCapabilityRunNotes("GSTR-2B", "PDF_AND_EXCEL"),
    ];
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(container.textContent).not.toContain(note);
    }
  });
});

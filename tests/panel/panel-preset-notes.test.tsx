import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));

import { PanelGuidedScope } from "../../src/entrypoints/panel/panel-guided-scope";
import { filedReturnsCapabilityRunNotes } from "../../src/connectors/gst/filed-returns-capabilities";
import { panelAllReturnsFullYearPreset } from "../../src/entrypoints/panel/panel-guided-scope-model";
import { PANEL_TEST_SCOPE } from "./panel-controller.test-helpers";

/**
 * Capability notes say what a portal offers -- "Includes Excel only when the portal provides
 * it" -- which is a fact a reader needs, not a problem to fix. They rendered through
 * `panel-preset-reason`, the class a *disabled* reason uses, which paints them in
 * `--pack-warning-fg`; two of the three recipes therefore looked like they were carrying
 * warnings before anyone had chosen anything. The note stays, the warning colour does not.
 */

const PANEL_STYLESHEET = readFileSync(join(process.cwd(), "src/styles/panel.css"), "utf8");

/**
 * The colour a class resolves to, read out of the stylesheet the panel actually ships. Asserting
 * the class name alone would keep passing if the rule were deleted or repointed at the warning
 * token, which is the regression this file exists to catch; JSDOM never loads the sheet, so the
 * declaration has to be looked up rather than computed.
 */
function declaredColor(className: string): string | undefined {
  const rule = new RegExp(`(?:^|\\})[^{}]*\\.${className}\\b[^{}]*\\{([^}]*)\\}`, "m").exec(
    PANEL_STYLESHEET,
  );
  return /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(rule?.[1] ?? "")?.[1]?.trim();
}

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
        onStartAllReturnsFullYear={() => undefined}
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T00:00:00.000Z"));
    dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true, url: "https://x.test" });
    Object.assign(globalThis, { document: dom.window.document, window: dom.window });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.getElementById("root") as Element;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("renders factual recipe and capability notes without the warning styling a disabled reason uses", async () => {
    await render();

    // Read the notes from the catalogue rather than restating them, so this keeps holding if
    // their wording changes.
    const allReturnsNotes = ["2025-26", "2026-27"].flatMap((financialYear) => {
      const preset = panelAllReturnsFullYearPreset(financialYear, new Date());
      return preset ? [preset.note] : [];
    });
    const notes = [
      ...allReturnsNotes,
      ...filedReturnsCapabilityRunNotes("GSTR-1", "PDF_AND_EXCEL"),
      ...filedReturnsCapabilityRunNotes("GSTR-2B", "PDF_AND_EXCEL"),
    ];
    expect(allReturnsNotes).toHaveLength(2);
    expect(notes.length).toBeGreaterThan(0);

    // Guard the precondition: if no card rendered, everything below would be vacuous.
    expect(container.querySelectorAll(".panel-preset-note").length).toBe(notes.length);

    const warningColor = declaredColor("panel-preset-reason");
    expect(warningColor).toBe("var(--pack-warning-fg)");

    for (const note of notes) {
      const node = [...container.querySelectorAll("p")].find(
        (candidate) => candidate.textContent === note,
      );
      expect(node, `no element renders ${note}`).toBeDefined();

      // Derive the colour from the class the note actually carries, so repointing that class at
      // the warning token -- or deleting its rule -- fails here.
      const color = declaredColor(node?.className ?? "");
      expect(color).toBeDefined();
      expect(color).not.toBe(warningColor);
    }
  });
});

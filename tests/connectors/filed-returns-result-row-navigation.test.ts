import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/core/contracts";
import { resolveGstr1FiledReturnViewPoint } from "../../src/connectors/gst/filed-returns-result-row-navigation";
import {
  hasSettledFiledReturnsSearchForScope,
  markFiledReturnsSearchPending,
} from "../../src/connectors/gst/filed-returns-search-state";

const SCOPE: FiledReturnsDownloadScope = {
  artifactType: "PDF",
  financialYear: "2025-26",
  period: "April",
  returnType: "GSTR-1",
};

describe("target-bound filed GSTR-1 View point", () => {
  it("returns the center of one visible unobscured exact result action", async () => {
    const documentRef = createExactResultDocument(1);
    const view = documentRef.querySelector<HTMLElement>("[data-view='0']");
    if (!view) throw new Error("Expected View control.");
    setLayout(documentRef, view, { left: 100, top: 200, width: 80, height: 40 });

    const result = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);

    expect(result).toEqual({ ok: true, point: { x: 140, y: 220 } });
  });

  it("refuses to resolve an ambiguous filed result", async () => {
    const documentRef = createExactResultDocument(2);

    const result = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);

    expect(result).toMatchObject({
      ok: false,
      flowStep: {
        state: "blocked",
        safeSignals: ["filed-return-result-row-ambiguous"],
      },
    });
  });

  it("refuses an obscured or offscreen View action", async () => {
    const documentRef = createExactResultDocument(1);
    const view = documentRef.querySelector<HTMLElement>("[data-view='0']");
    const obstruction = documentRef.querySelector<HTMLElement>("[data-obstruction]");
    if (!view || !obstruction) throw new Error("Expected test controls.");
    setLayout(documentRef, view, { left: 100, top: 200, width: 80, height: 40 }, obstruction);

    const result = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);

    expect(result).toMatchObject({
      ok: false,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-gstr1-result-view-point-unavailable"]),
      },
    });
  });

  it("preserves a filter-bound card across debugger point preflight and re-resolution", async () => {
    const documentRef = createFilterBoundResultDocument();
    const resultSurface = documentRef.querySelector("section");
    const view = documentRef.querySelector<HTMLElement>("[data-view]");
    if (!resultSurface || !view) throw new Error("Expected filter-bound result controls.");
    resultSurface.remove();
    markFiledReturnsSearchPending(documentRef, SCOPE);
    documentRef.querySelector("main")?.append(resultSurface);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, SCOPE)).toBe(true);
    setLayout(documentRef, view, { left: 100, top: 200, width: 80, height: 40 });

    const preflight = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);
    const attached = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);

    expect(preflight).toEqual({ ok: true, point: { x: 140, y: 220 } });
    expect(attached).toEqual(preflight);
  });
});

function createExactResultDocument(resultCount: number): Document {
  const dom = new JSDOM(
    `<!doctype html><html><body><main>
      <h1>View Filed Returns</h1>
      <table>
        <thead><tr><th>Return Type</th><th>Financial Year</th><th>Period</th><th>Status</th><th>View</th></tr></thead>
        <tbody>
          ${Array.from(
            { length: resultCount },
            (_, index) =>
              `<tr><td>GSTR-1 / IFF</td><td>2025-26</td><td>April</td><td>Filed</td><td><button data-view="${index}">View</button></td></tr>`,
          ).join("")}
        </tbody>
      </table>
      <div data-obstruction></div>
    </main></body></html>`,
    { url: "https://return.gst.gov.in/returns/auth/efiledReturns" },
  );
  return dom.window.document;
}

function createFilterBoundResultDocument(): Document {
  return new JSDOM(
    `<!doctype html><html><body><main>
      <form name="efiledReturns">
        <label>Financial Year</label><select><option selected>2025-26</option></select>
        <label>Return Filing Period</label><select><option selected>Monthly</option></select>
        <label>Month</label><select><option selected>April</option></select>
        <label>Return Type</label><select><option selected>GSTR-1/IFF/GSTR-1A</option></select>
      </form>
      <section aria-label="Search results">
        <article><h2>GSTR-1 / IFF</h2><p>Filed return</p><button data-view>View</button></article>
      </section>
    </main></body></html>`,
    { url: "https://return.gst.gov.in/returns/auth/efiledReturns" },
  ).window.document;
}

function setLayout(
  documentRef: Document,
  view: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
  hitTarget: Element = view,
): void {
  const windowRef = documentRef.defaultView;
  if (!windowRef) throw new Error("Expected window.");
  Object.defineProperty(windowRef, "innerWidth", { configurable: true, value: 1000 });
  Object.defineProperty(windowRef, "innerHeight", { configurable: true, value: 800 });
  view.scrollIntoView = vi.fn();
  view.getBoundingClientRect = vi.fn(() => ({
    ...rect,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  }));
  Object.defineProperty(documentRef, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => hitTarget),
  });
}

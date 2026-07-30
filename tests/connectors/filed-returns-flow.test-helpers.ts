import { JSDOM } from "jsdom";
import { expect, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";
import {
  findGstr2bDashboardControl,
  findReturnDashboardControl,
} from "../../src/connectors/gst/gstr2b-dashboard-view";
import {
  hasSettledFiledReturnsSearchForScope,
  markFiledReturnsSearchPending,
} from "../../src/connectors/gst/filed-returns-search-state";
export const DEFAULT_SCOPE: FiledReturnsDownloadScope = {
  financialYear: "2025-26",
  period: "March",
  returnType: "GSTR-3B",
};
export function createDocument(body: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
  }).window.document;
}

export function createGstDocument(
  body: string,
  url = "https://return.gst.gov.in/returns/auth/efiledReturns",
): Document {
  const options: Record<string, unknown> = {
    pretendToBeVisual: true,
    url,
  };
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, options).window.document;
}

export function createGstr2bSummaryDocument(extraBody = ""): Document {
  const documentRef = createGstDocument(
    `
      <main>
        <h1>GSTR-2B</h1>
        <p>Financial Year - 2026-27</p>
        <p>Return Period - May</p>
        <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
        <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        ${extraBody}
      </main>
    `,
    "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
  );
  makeLayoutVisible(documentRef);
  return documentRef;
}

export function makeLayoutVisible(documentRef: Document) {
  Object.defineProperty(documentRef.defaultView?.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 10,
      height: 10,
      left: 0,
      right: 10,
      top: 0,
      width: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

export function appendOption(documentRef: Document, text: string, onClick: () => void) {
  const option = documentRef.createElement("button");
  option.setAttribute("role", "option");
  option.textContent = text;
  option.addEventListener("click", () => {
    onClick();
    option.remove();
  });
  documentRef.body.append(option);
}

export function appendOwnedOption(
  documentRef: Document,
  id: string,
  text: string,
  onClick: () => void,
) {
  const listbox = documentRef.createElement("div");
  listbox.id = id;
  listbox.setAttribute("role", "listbox");
  const option = documentRef.createElement("button");
  option.setAttribute("role", "option");
  option.textContent = text;
  option.addEventListener("click", () => {
    onClick();
    listbox.remove();
  });
  listbox.append(option);
  documentRef.body.append(listbox);
}

export function replaceGstr2bDashboardView(documentRef: Document): void {
  const previousView = findGstr2bDashboardControl(documentRef, "view");
  expect(previousView).not.toBeNull();
  if (!previousView) return;
  const replacement = previousView.cloneNode(true) as HTMLElement;
  replacement.addEventListener("click", () => previousView.click());
  previousView.replaceWith(replacement);
}

export function replaceDashboardView(
  documentRef: Document,
  returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B",
): void {
  const previousView = findReturnDashboardControl(documentRef, returnType, "view");
  expect(previousView).not.toBeNull();
  if (!previousView) return;
  const replacement = previousView.cloneNode(true) as HTMLElement;
  replacement.addEventListener("click", () => previousView.click());
  previousView.replaceWith(replacement);
}

export function appendNativeOption(
  documentRef: Document,
  select: HTMLSelectElement | null,
  text: string,
) {
  const option = documentRef.createElement("option");
  option.textContent = text;
  option.value = text;
  select?.append(option);
}

export function stubFiledReturnsApi(
  documentRef: Document,
  responses: { rows: unknown; roleStatus: unknown | null },
) {
  Object.defineProperty(documentRef.defaultView, "fetch", {
    configurable: true,
    value: vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/returns/auth/api/rolestatus")) {
        return {
          json: async () => responses.roleStatus,
          ok: Boolean(responses.roleStatus),
        };
      }
      return {
        json: async () => responses.rows,
        ok: true,
      };
    }),
  });
}

export function stubFormSubmit(documentRef: Document): Array<{ action: string; method: string }> {
  const submittedForms: Array<{ action: string; method: string }> = [];
  Object.defineProperty(documentRef.defaultView?.HTMLFormElement.prototype, "submit", {
    configurable: true,
    value(this: HTMLFormElement) {
      submittedForms.push({
        action: this.getAttribute("action") ?? "",
        method: this.getAttribute("method") ?? "",
      });
    },
  });
  return submittedForms;
}

export function markPackSubmittedSearch(documentRef: Document, scope: FiledReturnsDownloadScope) {
  const settledContainers = detachSettledResults(documentRef);
  markFiledReturnsSearchPending(documentRef, scope);
  for (const container of settledContainers) {
    container.parent.append(container.element);
  }
  expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
  expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
}

export function createFilterBoundGstr1Results(rowCount = 1, cardCount = 0): Document {
  return createDocument(`
    <main>
      <h1>View Filed Returns</h1>
      <form name="efiledReturns">
        <label>Financial Year</label>
        <select id="finYr"><option selected>2025-26</option></select>
        <label>Return Filing Period</label>
        <select id="optValue"><option selected>Monthly</option></select>
        <label>Month</label>
        <select id="month"><option selected>April</option><option>May</option></select>
        <label>Return Type</label>
        <select id="retTyp"><option selected>GSTR-1/IFF/GSTR-1A</option></select>
        <button id="lotsearch" type="button">Search</button>
      </form>
      <section aria-label="Search results">
        <table>
          <thead><tr><th>Return Type</th><th>Status</th><th>View/Download</th></tr></thead>
          <tbody>
            ${Array.from(
              { length: rowCount },
              (_, index) =>
                `<tr><td>GSTR-1 / IFF</td><td>Filed</td><td><button data-view="${index}">View</button></td></tr>`,
            ).join("")}
          </tbody>
        </table>
        ${Array.from(
          { length: cardCount },
          (_, index) =>
            `<article><h2>GSTR-1 / IFF</h2><p>Filed return</p><button data-card-view="${index}">View</button></article>`,
        ).join("")}
      </section>
    </main>
  `);
}

export function detachSettledResults(
  documentRef: Document,
): Array<{ parent: Element; element: Element }> {
  const selectors = [
    "[aria-label*='result' i]",
    "[id*='result' i]",
    "[class*='result' i]",
    "table",
  ].join(",");
  return Array.from(documentRef.querySelectorAll(selectors))
    .filter((element) => element.parentElement)
    .map((element) => {
      const parent = element.parentElement as Element;
      element.remove();
      return { parent, element };
    });
}

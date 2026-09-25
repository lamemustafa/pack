import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import {
  DEFAULT_SCOPE,
  appendOption,
  createDocument,
  createGstDocument,
  makeLayoutVisible,
} from "./filed-returns-flow.test-helpers";

// #395. A browser fills both `innerText` and `textContent`, so a reader that joins the two reads
// every label twice ("VIEW VIEW"), and an exact or anchored label check never matches. jsdom has no
// `innerText`, which is why no test saw it (entry 37 in docs/PORTAL_INTEGRATION_FINDINGS.md). Each
// document here gets a browser-like `innerText` before the flow reads it.
function renderInnerTextLikeABrowser(documentRef: Document): Document {
  Object.defineProperty(documentRef.defaultView!.HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? "";
    },
  });
  return documentRef;
}

describe("labels read as a browser renders them (#395)", () => {
  // The Returns Dashboard tiles as captured live on 2026-09-21 (entry 38): the GSTR-1 tile with
  // VIEW/DOWNLOAD, the GSTR-2B statement tile with VIEW/DOWNLOAD, and VIEW GSTR3B. The GSTR-2B
  // View carries no `page_rtp` ng-click here, so only its label can identify it.
  it("opens the GSTR-2B View by its label, not the adjacent GSTR-1 View", async () => {
    const documentRef = renderInnerTextLikeABrowser(
      createGstDocument(
        `
          <main>
            <form name="dashboard">
              <label for="fy">Financial Year</label>
              <select id="fy" name="fin"><option selected>2026-27</option></select>
              <label for="quarter">Quarter</label>
              <select id="quarter" name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
              <label for="period">Period</label>
              <select id="period" name="mon"><option selected>May</option></select>
              <button type="button" data-search>Search</button>
            </form>
            <section class="return-grid">
              <article>
                <h3>Details of outward supplies of goods or services GSTR-1</h3>
                <p>Status- Filed</p>
                <button type="button" data-gstr1-view>VIEW</button>
                <button type="button">DOWNLOAD</button>
              </article>
              <article>
                <h3>Auto - drafted ITC Statement for the month GSTR-2B</h3>
                <button type="button" data-gstr2b-view>VIEW</button>
                <button type="button">DOWNLOAD</button>
              </article>
              <article>
                <h3>Monthly Return GSTR-3B</h3>
                <button type="button">VIEW GSTR3B</button>
                <button type="button">DOWNLOAD</button>
              </article>
            </section>
          </main>
        `,
        "https://return.gst.gov.in/returns/auth/dashboard",
      ),
    );
    makeLayoutVisible(documentRef);
    const clicks = { gstr1View: 0, gstr2bView: 0 };
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      clicks.gstr1View += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    await runFiledReturnsDownloadStep(documentRef, scope);
    // Search re-renders the tiles; a View that did not change is never trusted as a result.
    const staleView = documentRef.querySelector<HTMLElement>("[data-gstr2b-view]")!;
    const freshView = staleView.cloneNode(true) as HTMLElement;
    freshView.addEventListener("click", () => {
      clicks.gstr2bView += 1;
    });
    staleView.replaceWith(freshView);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(clicks).toEqual({ gstr1View: 0, gstr2bView: 1 });
  });

  // The GSTR-2B summary as captured live on 2026-08-24: a visible `BACK TO DASHBOARD` button with
  // no `href`, beside the actionable "Returns" quick-links anchor and, collapsed inside it, the one
  // "Returns Dashboard" anchor.
  it("leaves a GSTR-2B summary for another period by its Back to Dashboard button", async () => {
    const documentRef = renderInnerTextLikeABrowser(
      createGstDocument(
        `
          <nav>
            <a href="#" data-returns-menu>Returns</a>
            <ul style="display: none">
              <li><a href="#" data-returns-dashboard>Returns Dashboard</a></li>
            </ul>
          </nav>
          <main>
            <h1>GSTR-2B</h1>
            <p>May 2026 Auto-drafted ITC Statement</p>
            <button data-back>BACK TO DASHBOARD</button>
            <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
            <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
          </main>
        `,
        "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
      ),
    );
    makeLayoutVisible(documentRef);
    const history = vi
      .spyOn(documentRef.defaultView!.history, "back")
      .mockImplementation(() => undefined);
    const clicks = { back: 0, returnsMenu: 0 };
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      clicks.back += 1;
    });
    documentRef.querySelector("[data-returns-menu]")?.addEventListener("click", () => {
      clicks.returnsMenu += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    });

    expect(result.safeSignals).toContain("gstr2b-summary-dashboard-back-clicked");
    expect(clicks).toEqual({ back: 1, returnsMenu: 0 });
    expect(history).not.toHaveBeenCalled();
  });

  // No live capture of a custom-widget filter exists: the View Filed Returns form captured on
  // 2026-09-21 (entry 37) uses native selects, so this fallback is reached only on a page Pack has
  // not seen. The fixture is the one the fallback was written against; what is pinned is that a
  // browser-rendered label does not stop it from confirming the exact return type.
  it("selects a custom-widget GSTR-3B return type when labels render as in a browser", async () => {
    const documentRef = renderInnerTextLikeABrowser(
      createDocument(`
        <main>
          <h1>View Filed Returns</h1>
          <section>
            <div>
              <span>Financial Year</span>
              <button data-field="financial-year">2025-26</button>
            </div>
            <div>
              <span>Return Filing Period</span>
              <button data-field="period">Select</button>
            </div>
            <div>
              <span>Return Type</span>
              <button data-field="return-type">Select</button>
            </div>
            <button data-search>Search</button>
          </section>
        </main>
      `),
    );
    makeLayoutVisible(documentRef);
    const period = documentRef.querySelector<HTMLElement>("[data-field='period']")!;
    const returnType = documentRef.querySelector<HTMLElement>("[data-field='return-type']")!;
    let searchClicked = 0;
    period.addEventListener("click", () => {
      appendOption(documentRef, "March", () => {
        period.textContent = "March";
      });
    });
    returnType.addEventListener("click", () => {
      appendOption(documentRef, "GSTR-3B", () => {
        returnType.textContent = "GSTR-3B";
      });
    });
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["return-type-selected", "search-clicked"]),
    );
    expect(returnType.textContent).toBe("GSTR-3B");
    expect(searchClicked).toBe(1);
  });
});

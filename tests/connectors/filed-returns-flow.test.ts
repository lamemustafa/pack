import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/core/contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import { findGstr2bDashboardControl } from "../../src/connectors/gst/gstr2b-dashboard-view";
import { filedReturnScopeId } from "../../src/connectors/gst/filed-returns-return-descriptors";
import {
  triggerFiledGstr3bFiledPdfDownload,
  triggerFiledReturnDownload,
  triggerFiledReturnFiledPdfDownload,
} from "../../src/connectors/gst/filed-returns-download";
import { navigateToFiledReturnsPage } from "../../src/connectors/gst/filed-returns-navigator";
import { detectPostClickBlockedState } from "../../src/connectors/gst/filed-returns-post-click-blocked-state";
import {
  consumeSettledFiledReturnsSearchForScope,
  hasPendingFiledReturnsSearchForScope,
  hasSettledFiledReturnsSearchForScope,
  hasUnchangedFiledReturnsSearchForScope,
  markFiledReturnsSearchPending,
} from "../../src/connectors/gst/filed-returns-search-state";

const DEFAULT_SCOPE: FiledReturnsDownloadScope = {
  financialYear: "2025-26",
  period: "March",
  returnType: "GSTR-3B",
};

describe("filed returns guided flow", () => {
  it("blocks cleanly during GST scheduled downtime", async () => {
    const documentRef = createGstDocument(
      `
        <h4>Scheduled Downtime.</h4>
        <p>Scheduled Downtime! We are enhancing the services on the site.</p>
        <p>The services will not be available from Downtime Window: 27th June'26 12:00 AM to 27th June'26 02:30 AM.</p>
        <p>Kindly come back later!</p>
      `,
      "https://services.gst.gov.in/services/",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toEqual(["portal-scheduled-downtime"]);
    expect(result.safeMessage).toMatch(/scheduled downtime/i);
    expect(result.userAction).toEqual({
      type: "WAIT_FOR_PORTAL_AVAILABILITY",
      message: "Wait until the GST scheduled downtime window is over, then reopen Pack.",
      canResume: true,
    });
  });

  it("does not try portal navigation during GST scheduled downtime", async () => {
    const documentRef = createGstDocument(
      `
        <h4>Scheduled Downtime.</h4>
        <p>The services will not be available from Downtime Window: 27th June'26 12:00 AM to 27th June'26 02:30 AM.</p>
        <p>Kindly come back later!</p>
      `,
      "https://services.gst.gov.in/services/",
    );

    const result = await navigateToFiledReturnsPage(documentRef);

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toEqual(["portal-scheduled-downtime"]);
    expect(result.userAction?.type).toBe("WAIT_FOR_PORTAL_AVAILABILITY");
  });

  it("treats GST maintenance and temporary unavailability as portal downtime", async () => {
    const documentRef = createGstDocument(
      `
        <h4>GST Portal Maintenance</h4>
        <p>We are enhancing the services on the site.</p>
        <p>The portal is temporarily unavailable and under maintenance.</p>
      `,
      "https://services.gst.gov.in/services/login",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toEqual(["portal-scheduled-downtime"]);
    expect(result.userAction?.type).toBe("WAIT_FOR_PORTAL_AVAILABILITY");
  });

  it("treats the GST access-denied expired-session page as login-required", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h4>Access Denied!</h4>
          <p>Your session is expired or you don't have permission to access the requested page.</p>
          <a href="/services/login">Login</a>
        </main>
      `,
      "https://services.gst.gov.in/services/error/accessdenied",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("login-required");
    expect(result.safeSignals).toEqual(["portal-blocked-or-session-expired"]);
    expect(result.userAction).toEqual({
      type: "LOGIN",
      message: "Sign in to the GST portal, then reopen Pack on the authenticated page.",
      canResume: true,
    });
  });

  it("treats the GST system-error page as a retryable portal block", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h4>System Error</h4>
          <p>The portal is unable to process the request right now.</p>
        </main>
      `,
      "https://services.gst.gov.in/services/error/system",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("blocked");
    expect(result.scopeId).toBe(filedReturnScopeId("GSTR-3B"));
    expect(result.safeSignals).toEqual(["portal-system-error"]);
    expect(result.userAction).toEqual({
      type: "WAIT_FOR_PORTAL_AVAILABILITY",
      message: "Return to an authenticated GST page after the portal system error clears.",
      canResume: true,
    });
  });

  it.each(["GSTR-1", "GSTR-2B"] as const)(
    "attributes GST system errors to the active %s scope",
    async (returnType) => {
      const documentRef = createGstDocument(
        `
          <main>
            <h4>System Error</h4>
            <p>The portal is unable to process the request right now.</p>
          </main>
        `,
        "https://services.gst.gov.in/services/error/system",
      );

      const result = await runFiledReturnsDownloadStep(documentRef, {
        artifactType: "PDF",
        financialYear: "2025-26",
        period: "May",
        returnType,
      });

      expect(result).toMatchObject({
        scopeId: filedReturnScopeId(returnType),
        state: "blocked",
        safeSignals: ["portal-system-error"],
      });
    },
  );

  it("does not click Back from a filed GSTR-1 page without recognized download controls", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <a href="#">[Go Back]</a>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let backClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", (event) => {
      event.preventDefault();
      backClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["gstr-1-detail-route", "filed-gstr1-summary-view-pending"]),
    );
    expect(backClicked).toBe(0);
  });

  it("waits for GSTR-1 controls on an authenticated partial subroute", async () => {
    const documentRef = createGstDocument(
      `<main><h1>GSTR-1</h1><p>The return workspace is loading.</p></main>`,
      "https://return.gst.gov.in/returns/auth/gstr1/dashboard",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: expect.arrayContaining(["filed-gstr1-controls-pending"]),
    });
    expect(result.userAction).toBeUndefined();
  });

  it("does not block a usable filed-returns page for a future downtime banner", async () => {
    const documentRef = createGstDocument(`
      <main>
        <aside>Scheduled Downtime: services will not be available during a future downtime window.</aside>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select><option>2024-25</option><option>2025-26</option></select>
          <label>Return Filing Period</label>
          <select><option>February</option><option>March</option></select>
          <label>Return Type</label>
          <select><option>GSTR-1</option><option>GSTR-3B</option></select>
          <button type="button">Search</button>
        </form>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["search-clicked"]));
    expect(result.safeSignals).not.toContain("portal-scheduled-downtime");
    expect(searchClicked).toBe(1);
  });

  it("does not try final download trigger during GST scheduled downtime", async () => {
    const documentRef = createGstDocument(
      `
        <h4>Scheduled Downtime.</h4>
        <p>Scheduled Downtime! We are enhancing the services on the site.</p>
        <p>Kindly come back later!</p>
      `,
      "https://return.gst.gov.in/returns/auth/gstr3b",
    );

    const result = await triggerFiledGstr3bFiledPdfDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toEqual(["portal-scheduled-downtime"]);
    expect(result.userAction?.type).toBe("WAIT_FOR_PORTAL_AVAILABILITY");
  });

  it("recognises the matching GSTR-2B summary page as portal-capture ready", async () => {
    const documentRef = createGstr2bSummaryDocument();

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-summary-route",
        "gstr2b-visible-period-verified",
        "gstr2b-download-ready",
        "filed-return-download-ready",
      ]),
    );
  });

  it("waits for the GST portal to close a session warning after Continue", async () => {
    const documentRef = createGstr2bSummaryDocument(`
      <section class="modal show" role="dialog">
        <h2>Warning</h2>
        <p>Your logged in session will expire in next 02:54 Minutes. Click Continue to extend your session, or click Logout to logout of the application.</p>
        <a data-logout href="/services/logout">Logout</a>
        <button data-continue>Continue</button>
      </section>
      <div class="modal-backdrop show"></div>
    `);
    let continueClicked = 0;
    let logoutClicked = 0;
    documentRef.querySelector("[data-continue]")?.addEventListener("click", () => {
      continueClicked += 1;
    });
    documentRef.querySelector("[data-logout]")?.addEventListener("click", (event) => {
      event.preventDefault();
      logoutClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "safe-dialog-dismissed",
        "dialog-continue",
        "safe-dialog-still-visible",
        "gstr2b-dialog-dismissal-waiting",
      ]),
    );
    expect(continueClicked).toBe(1);
    expect(logoutClicked).toBe(0);
    expect(documentRef.querySelector<HTMLElement>(".modal")?.style.display).not.toBe("none");
    expect(documentRef.querySelector(".modal-backdrop")).not.toBeNull();
  });

  it("selects GSTR-2B filters from the filed-returns page", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select data-year>
            <option>Select</option>
            <option>2026-27</option>
            <option>2025-26</option>
          </select>
          <label>Return Filing Period</label>
          <select data-period>
            <option>Select</option>
            <option>Annual</option>
            <option>Quarterly</option>
            <option>Monthly</option>
          </select>
          <label>Return Type</label>
          <select data-return-type>
            <option>Select</option>
            <option>GSTR1</option>
            <option>GSTR2B</option>
            <option>GSTR3B</option>
          </select>
          <button type="button">SEARCH</button>
        </form>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["search-clicked"]));
    expect(documentRef.querySelector<HTMLSelectElement>("[data-year]")?.value).toBe("2025-26");
    expect(documentRef.querySelector<HTMLSelectElement>("[data-period]")?.value).toBe("Monthly");
    expect(documentRef.querySelector<HTMLSelectElement>("[data-return-type]")?.value).toBe(
      "GSTR2B",
    );
    expect(searchClicked).toBe(1);
  });

  it("leaves View Filed Returns for Return Dashboard when GSTR-2B is not an offered return type", async () => {
    const documentRef = createGstDocument(`
      <main>
        <nav><a data-dashboard href="/returns/auth/dashboard">Return Dashboard</a></nav>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select>
            <option>Select</option>
            <option>2025-26</option>
          </select>
          <label>Return Filing Period</label>
          <select>
            <option>Select</option>
            <option>Monthly</option>
          </select>
          <label>Month</label>
          <select>
            <option>Select</option>
            <option>April</option>
          </select>
          <label>Return Type</label>
          <select>
            <option>Select</option>
            <option>GSTR-1/IFF/GSTR-1A</option>
            <option>GSTR3B</option>
          </select>
          <button type="button">SEARCH</button>
        </form>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let dashboardClicked = 0;
    documentRef.querySelector("[data-dashboard]")?.addEventListener("click", (event) => {
      event.preventDefault();
      dashboardClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-filed-returns-no-gstr2b-option",
        "return-dashboard-candidate-clicked",
      ]),
    );
    expect(dashboardClicked).toBe(1);
  });

  it("opens the matching GSTR-2B result row from the filed-returns page", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead>
            <tr>
              <th>Financial Year</th>
              <th>Tax Period</th>
              <th>Return Type</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>2025-26</td>
              <td>April</td>
              <td>GSTR2B</td>
              <td><button type="button">View</button></td>
            </tr>
          </tbody>
        </table>
      </main>
    `);
    let viewClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-result-view-clicked",
        "gstr2b-filed-return-result-view-clicked",
      ]),
    );
    expect(viewClicked).toBe(1);
  });

  it("waits for one pending GSTR-2B filed-return search instead of clicking Search again", async () => {
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    };
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select><option selected>2025-26</option></select>
          <label>Return Filing Period</label>
          <select><option selected>Monthly</option></select>
          <label>Month</label>
          <select><option selected>April</option></select>
          <label>Return Type</label>
          <select><option selected>GSTR-2B</option></select>
          <button type="button">Search</button>
        </form>
      </main>
    `);
    let searched = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      searched += 1;
    });
    markFiledReturnsSearchPending(documentRef, scope);

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: expect.arrayContaining([
        "filed-return-search-results-pending",
        "gstr2b-filed-return-search-results-pending",
      ]),
    });
    expect(searched).toBe(0);
  });

  it("ignores unrelated GSTR-2B localStorage when deciding portal-capture readiness", async () => {
    const documentRef = createGstr2bSummaryDocument();
    vi.stubGlobal("localStorage", documentRef.defaultView?.localStorage);
    localStorage.setItem("rtn_prd", "042026");
    localStorage.setItem("sum042026", JSON.stringify({ summary: { available: true } }));

    try {
      const result = await runFiledReturnsDownloadStep(documentRef, {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      });

      expect(result.state).toBe("ready");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "gstr2b-summary-route",
          "gstr2b-visible-period-verified",
          "gstr2b-download-ready",
          "filed-return-download-ready",
        ]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["GSTR-1", "GSTR-3B"] as const)(
    "leaves the GSTR-2B summary page before starting a %s filed-return run",
    async (returnType) => {
      const documentRef = createGstr2bSummaryDocument(`
        <nav>
          <a data-return-dashboard href="/returns/auth/dashboard">Return Dashboard</a>
        </nav>
      `);
      let dashboardClicked = 0;
      documentRef.querySelector("[data-return-dashboard]")?.addEventListener("click", (event) => {
        event.preventDefault();
        dashboardClicked += 1;
      });

      const result = await runFiledReturnsDownloadStep(documentRef, {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType,
      });

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "gstr2b-summary-route-mismatched-return",
          "return-dashboard-candidate-clicked",
        ]),
      );
      expect(result.safeMessage).toMatch(new RegExp(`filed ${returnType}`));
      expect(dashboardClicked).toBe(1);
    },
  );

  it("captures the portal-generated GSTR-2B PDF instead of generating a local artifact", async () => {
    const documentRef = createGstr2bSummaryDocument();

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "action-gstr2b-pdf",
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "action-gstr2b-pdf",
      signalPrefix: "filed-gstr2b",
    });
    expect(result.mainWorldCaptureRequest?.timeoutMs).toBe(15_000);
    expect(result.downloadTrigger.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-download-clicked",
        "filed-gstr2b-download-clicked",
        "filed-gstr2b-portal-blob-download-captured",
        "filed-gstr2b-extension-download-requested",
      ]),
    );
  });

  it.each(["PDF", "EXCEL"] as const)(
    "uses the verified GSTR-2B %s portal control for the target-bound fallback",
    async (artifactType) => {
      const documentRef = createGstr2bSummaryDocument();
      const expectedControl = Array.from(documentRef.querySelectorAll<HTMLElement>("button")).find(
        (element) =>
          element.textContent?.includes(artifactType === "EXCEL" ? "DETAILS" : "SUMMARY"),
      );
      let clickCount = 0;
      expectedControl?.addEventListener("click", () => {
        clickCount += 1;
      });

      const result = await triggerFiledReturnDownload(documentRef, {
        actionId: `action-gstr2b-${artifactType.toLowerCase()}-fallback`,
        artifactType,
        financialYear: "2026-27",
        forcePortalClick: true,
        period: "May",
        returnType: "GSTR-2B",
      });

      expect(result.mainWorldCaptureRequest).toBeUndefined();
      expect(clickCount).toBe(0);
      await new Promise<void>((resolve) => documentRef.defaultView?.setTimeout(resolve, 0));
      expect(clickCount).toBe(1);
      expect(result.downloadTrigger).toMatchObject({
        state: "clicked",
        safeSignals: expect.arrayContaining([
          "filed-gstr2b-download-clicked",
          "filed-gstr2b-portal-blob-download-click-scheduled",
          `filed-return-artifact-clicked:${artifactType}`,
        ]),
      });
    },
  );

  it("finds GSTR-2B download controls when the section carries the return label", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section>
            <h1>GSTR-2B</h1>
            <p>Financial Year - 2026-27</p>
            <p>Return Period - May</p>
            <button data-pdf>Summary PDF</button>
            <button data-excel>Details Excel</button>
          </section>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "action-gstr2b-short-labels",
      artifactType: "EXCEL",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.downloadTrigger.state).toBe("clicked");
    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "action-gstr2b-short-labels",
      signalPrefix: "filed-gstr2b",
    });
  });

  it("finds GSTR-2B download controls when the portal uses non-standard dash spacing", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR&#8209;2B- AUTO-DRAFTED ITC STATEMENT</h1>
          <p>Financial Year - 2026-27</p>
          <p>Return Period - May</p>
          <button>DOWNLOAD GSTR&#8209;2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR&#8209;2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "action-gstr2b-live-label",
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.downloadTrigger.state).toBe("clicked");
    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "action-gstr2b-live-label",
      signalPrefix: "filed-gstr2b",
    });
  });

  it("ignores hidden duplicate GSTR-2B download controls on the summary page", async () => {
    const documentRef = createGstr2bSummaryDocument(`
      <button hidden>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
      <button aria-disabled="true">DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
    `);

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "action-gstr2b-visible-control",
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.downloadTrigger.state).toBe("clicked");
    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "action-gstr2b-visible-control",
      signalPrefix: "filed-gstr2b",
    });
  });

  it("blocks when the portal renders multiple visible GSTR-2B PDF controls", async () => {
    const documentRef = createGstr2bSummaryDocument(`
      <button data-compact>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
    `);

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "action-gstr2b-duplicate-visible-pdf",
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.downloadTrigger.state).toBe("candidate-not-found");
    expect(result.downloadTrigger.safeSignals).toContain(
      "filed-gstr2b-download-candidate-ambiguous",
    );
    expect(result.mainWorldCaptureRequest).toBeUndefined();
  });

  it("captures the portal-generated GSTR-2B file even when localStorage contains period JSON", async () => {
    const documentRef = createGstr2bSummaryDocument();
    vi.stubGlobal("localStorage", documentRef.defaultView?.localStorage);
    try {
      localStorage.setItem("rtn_prd", "052026");
      localStorage.setItem(
        "sum052026masked-source",
        JSON.stringify({ summary: { available: true } }),
      );

      const result = await triggerFiledReturnDownload(documentRef, {
        actionId: "action-gstr2b-alternate",
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      });

      expect(result.mainWorldCaptureRequest).toMatchObject({
        actionId: "action-gstr2b-alternate",
        signalPrefix: "filed-gstr2b",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("captures the portal-generated GSTR-2B Excel instead of generating a local workbook", async () => {
    const documentRef = createGstr2bSummaryDocument();

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "action-gstr2b-excel",
      artifactType: "EXCEL",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "action-gstr2b-excel",
      signalPrefix: "filed-gstr2b",
    });
  });

  it("does not use stale GSTR-2B local JSON as a download source", async () => {
    const documentRef = createGstr2bSummaryDocument();
    vi.stubGlobal("localStorage", documentRef.defaultView?.localStorage);
    try {
      localStorage.setItem("rtn_prd", "042026");
      localStorage.setItem("sum052026", JSON.stringify({ summary: { available: true } }));

      const result = await triggerFiledReturnDownload(documentRef, {
        actionId: "action-gstr2b-stale",
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      });

      expect(result.mainWorldCaptureRequest).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("navigates authenticated wrong-page GSTR-2B starts through the Return Dashboard", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GST Dashboard</h1>
          <a href="https://return.gst.gov.in/returns/auth/dashboard">RETURN DASHBOARD</a>
        </main>
      `,
      "https://services.gst.gov.in/services/auth/fowelcome",
    );
    makeLayoutVisible(documentRef);
    const clickedHrefs: string[] = [];
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    documentRef.body.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof view.HTMLAnchorElement) {
        event.preventDefault();
        clickedHrefs.push(target.href);
      }
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("return-dashboard-candidate-clicked");
    expect(result.safeSignals).toContain("gstr2b-wrong-page");
    expect(clickedHrefs).toEqual(["https://return.gst.gov.in/returns/auth/dashboard"]);
  });

  it("reveals the Services menu before navigating wrong-page GSTR-2B starts", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <button data-services>Services</button>
          <nav hidden data-menu></nav>
          <h1>Electronic Credit Ledger</h1>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/ledger/itcledger",
    );
    makeLayoutVisible(documentRef);
    const menu = documentRef.querySelector<HTMLElement>("[data-menu]");
    documentRef.querySelector("[data-services]")?.addEventListener("click", () => {
      menu?.removeAttribute("hidden");
      const link = documentRef.createElement("a");
      link.href = "https://return.gst.gov.in/returns/auth/dashboard";
      link.textContent = "Returns Dashboard";
      menu?.append(link);
    });

    const clickedHrefs: string[] = [];
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    documentRef.body.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof view.HTMLAnchorElement) {
        event.preventDefault();
        clickedHrefs.push(target.href);
      }
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-wrong-page",
        "return-dashboard-after-services-menu",
        "return-dashboard-candidate-clicked",
      ]),
    );
    expect(clickedHrefs).toEqual(["https://return.gst.gov.in/returns/auth/dashboard"]);
  });

  it("stages the GSTR-2B return dashboard quarter change before selecting the dependent period", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option selected>July</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    let viewClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(viewClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("#quarter")?.value).toContain("Quarter 1");
    expect(documentRef.querySelector<HTMLSelectElement>("#period")?.value).toBe("July");
  });

  it("resolves GSTR-2B dashboard controls from the full page when the search root is narrow", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section>
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option selected>July</option>
            </select>
            <div><button type="button" data-search>Search</button></div>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    const narrowSearchRoot = documentRef.createElement("div");
    narrowSearchRoot.append(documentRef.querySelector("[data-search]") as HTMLElement);
    documentRef.body.append(narrowSearchRoot);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "gstr2b-dashboard-quarter-select-found",
        "quarter-selected",
      ]),
    );
    expect(documentRef.querySelector<HTMLSelectElement>("#quarter")?.value).toContain("Quarter 1");
  });

  it("stages the GSTR-2B return dashboard period change after Angular refreshes Q1 months", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
              <option>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option>April</option>
              <option>May</option>
              <option selected>June</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "period-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("#period")?.value).toBe("May");
  });

  it("clicks GSTR-2B dashboard search only after requested filters are already settled", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
              <option>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option>April</option>
              <option selected>May</option>
              <option>June</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["gstr2b-return-dashboard-filters-selected", "search-clicked"]),
    );
    expect(searchClicked).toBe(1);
  });

  it("clicks the GSTR-2B View control instead of adjacent GSTR-1 dashboard controls", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option selected>May</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
          <section class="return-grid">
            <article>
              <h3>Details of outward supplies of goods or services GSTR-1</h3>
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
    );
    makeLayoutVisible(documentRef);
    let gstr1ViewClicked = 0;
    let gstr2bViewClicked = 0;
    let searchClicked = 0;
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      gstr1ViewClicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      gstr2bViewClicked += 1;
    });
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    const stabilizingResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(stabilizingResult.safeSignals).toContain(
      "gstr2b-return-dashboard-search-results-pending",
    );
    expect(stabilizingResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(gstr1ViewClicked).toBe(0);
    expect(gstr2bViewClicked).toBe(1);
    expect(searchClicked).toBe(1);
  });

  it("keeps the unchanged GSTR-2B View pending after an in-place status mutation", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
    expect(pendingResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);

    const resultStatus = documentRef.createElement("span");
    resultStatus.textContent = "Generated";
    documentRef.querySelector("article")?.append(resultStatus);
    await Promise.resolve();
    const stabilizingResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const stillPendingResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(stabilizingResult.safeSignals).toContain(
      "gstr2b-return-dashboard-search-results-pending",
    );
    expect(stillPendingResult.safeSignals).toContain(
      "gstr2b-return-dashboard-search-results-pending",
    );
    expect(stillPendingResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);
  });

  it("requires manual recovery instead of releasing an unchanged pre-search GSTR-2B View", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(
        `
          <main>
            <form>
              <select name="fin"><option selected>2026-27</option></select>
              <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
              <select name="mon"><option selected>May</option></select>
              <button type="button">Search</button>
            </form>
            <article>
              <h3>Auto-drafted ITC Statement GSTR-2B</h3>
              <button data-gstr2b-view>VIEW</button>
            </article>
          </main>
        `,
        "https://return.gst.gov.in/returns/auth/dashboard",
      );
      makeLayoutVisible(documentRef);
      let viewClicked = 0;
      documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
        viewClicked += 1;
      });
      const scope: FiledReturnsDownloadScope = {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      };

      const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
      const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(12_000);
      const recoveryResult = await runFiledReturnsDownloadStep(documentRef, scope);

      expect(searchResult.safeSignals).toContain("search-clicked");
      expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
      expect(recoveryResult.state).toBe("user-action-required");
      expect(recoveryResult.safeSignals).toContain("gstr2b-dashboard-view-unchanged-after-search");
      expect(recoveryResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
      expect(recoveryResult.userAction).toMatchObject({
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        canResume: true,
      });
      expect(viewClicked).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores hidden GSTR-2B View templates after Search", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button" data-search>Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button hidden data-gstr2b-view data-ng-click="page_rtp()">VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };
    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
    expect(pendingResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);
  });

  it("does not scope a visible View from a hidden GSTR-2B sibling", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button" data-search>Search</button>
          </form>
          <article>
            <span hidden>Auto-drafted ITC Statement GSTR-2B</span>
            <span>Another return</span>
            <button data-visible-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-visible-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
    expect(result.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);
  });

  it("never releases an unchanged pre-search GSTR-2B View despite nearby mutations", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(
        `
          <main>
            <form>
              <select name="fin"><option selected>2026-27</option></select>
              <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
              <select name="mon"><option selected>May</option></select>
              <button type="button" data-search>Search</button>
            </form>
            <article>
              <h3>Auto-drafted ITC Statement GSTR-2B</h3>
              <span data-status>Loading</span>
              <button data-gstr2b-view>VIEW</button>
            </article>
          </main>
        `,
        "https://return.gst.gov.in/returns/auth/dashboard",
      );
      makeLayoutVisible(documentRef);
      let searchClicked = 0;
      let viewClicked = 0;
      documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
        searchClicked += 1;
      });
      documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
        viewClicked += 1;
      });
      const scope: FiledReturnsDownloadScope = {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      };

      await runFiledReturnsDownloadStep(documentRef, scope);
      let pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);
      for (let second = 1; second <= 11; second += 1) {
        const status = documentRef.querySelector("[data-status]");
        if (status) status.textContent = `Loading ${second}`;
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1_000);
        pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);
      }

      expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
      expect(searchClicked).toBe(1);
      expect(viewClicked).toBe(0);

      const status = documentRef.querySelector("[data-status]");
      if (status) status.textContent = "Loading 12";
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_000);
      const recoveryAfterBudget = await runFiledReturnsDownloadStep(documentRef, scope);
      expect(recoveryAfterBudget.state).toBe("user-action-required");
      expect(recoveryAfterBudget.safeSignals).toContain(
        "gstr2b-dashboard-view-unchanged-after-search",
      );
      expect(recoveryAfterBudget.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
      expect(searchClicked).toBe(1);
      expect(viewClicked).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires a mutated GSTR-2B search when no usable View result appears", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(
        `
          <main>
            <form>
              <select name="fin"><option selected>2026-27</option></select>
              <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
              <select name="mon"><option selected>May</option></select>
              <button type="button" data-search>Search</button>
            </form>
            <article>
              <h3>Auto-drafted ITC Statement GSTR-2B</h3>
              <span data-status>Loading</span>
              <button data-gstr2b-view>VIEW</button>
            </article>
          </main>
        `,
        "https://return.gst.gov.in/returns/auth/dashboard",
      );
      makeLayoutVisible(documentRef);
      let searchClicked = 0;
      documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
        searchClicked += 1;
      });
      const scope: FiledReturnsDownloadScope = {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      };

      await runFiledReturnsDownloadStep(documentRef, scope);
      const status = documentRef.querySelector("[data-status]");
      if (status) status.textContent = "No records";
      documentRef.querySelector("[data-gstr2b-view]")?.remove();
      await Promise.resolve();
      const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(12_000);
      const retryResult = await runFiledReturnsDownloadStep(documentRef, scope);

      expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
      expect(retryResult.safeSignals).toContain("search-clicked");
      expect(searchClicked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the GSTR-2B return dashboard controls when the portal shell is still blank", async () => {
    const documentRef = createGstDocument("", "https://return.gst.gov.in/returns/auth/dashboard");

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-return-dashboard-loading");
    expect(result.userAction).toBeUndefined();
  });

  it("waits with redacted GSTR-2B dashboard diagnostics when controls are incomplete", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section>
            <div>Financial Year *</div>
            <select name="fin">
              <option selected>2026-27</option>
            </select>
            <div>Quarter *</div>
            <select name="quarter">
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <p>Period controls are still rendering.</p>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.userAction).toBeUndefined();
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-route",
        "gstr2b-dashboard-year-select-found",
        "gstr2b-dashboard-quarter-select-found",
        "gstr2b-dashboard-period-select-missing",
        "gstr2b-dashboard-search-missing",
        "gstr2b-dashboard-selected-year:2026-27",
      ]),
    );
    expect(result.safeMessage).toContain("waiting for target-bound dashboard controls");
    expect(result.safeMessage).toContain("Diagnostic signals:");
  });

  it("does not open an unscoped GSTR-2B View when dashboard filters are absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-unscoped");
    expect(result.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);
  });

  it("preserves GSTR-2B View recovery when scoped search controls disappear", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form data-filters>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector("[data-filters]")?.remove();
    const viewResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(viewResult.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(1);
  });

  it("preserves target-bound GSTR-2B View recovery after the search retry window", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form data-filters>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector("[data-filters]")?.remove();
    now.mockReturnValue(20_000);
    const viewResult = await runFiledReturnsDownloadStep(documentRef, scope);

    now.mockRestore();
    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(viewResult.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(1);
  });

  it("invalidates GSTR-2B View recovery when dashboard filters change after Search", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form data-filters>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option><option>June</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const period = documentRef.querySelector<HTMLSelectElement>("select[name='mon']");
    period!.value = "June";
    period!.dispatchEvent(new documentRef.defaultView!.Event("change", { bubbles: true }));
    const changedFilterResult = await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector("[data-filters]")?.remove();
    const viewResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(changedFilterResult.safeSignals).toContain("period-selected");
    expect(changedFilterResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewResult.safeSignals).toContain("gstr2b-dashboard-view-unscoped");
    expect(viewClicked).toBe(0);
  });

  it("selects GSTR-2B dashboard filters when the search button ancestor omits labels", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <div>
            <label for="fy">Financial Year</label>
            <select id="fy" name="finyr">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="period">
              <option>May</option>
              <option selected>July</option>
            </select>
          </div>
          <aside>
            <span><button type="button" data-search>SEARCH</button></span>
          </aside>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("#quarter")?.value).toContain("Quarter 1");
    expect(documentRef.querySelector<HTMLSelectElement>("#period")?.value).toBe("July");
  });

  it("selects GSTR-2B dashboard filters from the live portal ordered select layout", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section>
            <div>Financial Year *</div>
            <select>
              <option selected>2026-27</option>
            </select>
            <div>Quarter *</div>
            <select>
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <div>Period *</div>
            <select>
              <option>May</option>
              <option selected>July</option>
            </select>
            <button type="button" data-search>SEARCH</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelectorAll<HTMLSelectElement>("select")[1]?.value).toContain(
      "Quarter 1",
    );
    expect(documentRef.querySelectorAll<HTMLSelectElement>("select")[2]?.value).toBe("July");
  });

  it("clicks search when GSTR-2B dashboard filters already match but the card is absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section>
            <div>Financial Year *</div>
            <select name="fin">
              <option selected>2026-27</option>
            </select>
            <div>Quarter *</div>
            <select name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <div>Period *</div>
            <select name="mon">
              <option selected>May</option>
            </select>
            <button type="button" data-search>Search</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filters-selected",
        "gstr2b-dashboard-selected-period:may",
        "search-clicked",
      ]),
    );
    expect(
      result.safeSignals.some((signal) => signal.startsWith("gstr2b-dashboard-selected-quarter:")),
    ).toBe(true);
    expect(searchClicked).toBe(1);
  });

  it("waits for GSTR-2B dashboard results after searching instead of clicking Search repeatedly", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fin">Financial Year</label>
            <select name="fin">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <label for="mon">Period</label>
            <select name="mon">
              <option selected>May</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(pendingResult.state).toBe("clicked");
    expect(pendingResult.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filters-selected",
        "gstr2b-return-dashboard-search-results-pending",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("does not reuse a pending GSTR-2B dashboard search after the target period changes", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fin">Financial Year</label>
            <select name="fin"><option selected>2026-27</option></select>
            <label for="quarter">Quarter</label>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <label for="mon">Period</label>
            <select name="mon"><option>April</option><option selected>May</option></select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });
    const mayScope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };
    const aprilScope: FiledReturnsDownloadScope = { ...mayScope, period: "April" };

    const maySearch = await runFiledReturnsDownloadStep(documentRef, mayScope);
    const aprilSelection = await runFiledReturnsDownloadStep(documentRef, aprilScope);
    const aprilSearch = await runFiledReturnsDownloadStep(documentRef, aprilScope);

    expect(maySearch.safeSignals).toContain("search-clicked");
    expect(aprilSelection.safeSignals).toContain("period-selected");
    expect(aprilSearch.safeSignals).toContain("search-clicked");
    expect(aprilSearch.safeSignals).not.toContain("gstr2b-return-dashboard-search-results-pending");
    expect(searchClicked).toBe(2);
  });

  it("selects GSTR-2B prior-year dashboard filters when the quarter field is absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard" data-ng-submit="returnPrd(dropdownValues.finyr,dropdownValues.reqmonth)">
            <label for="fin">Financial Year</label>
            <select name="fin" data-ng-model="dropdownValues.finyr">
              <option label="2026-27" value="object:187">2026-27</option>
              <option label="2025-26" value="object:188" selected>2025-26</option>
            </select>
            <label for="mon">Period</label>
            <select name="mon" data-ng-model="dropdownValues.reqmonth">
              <option label="April" value="object:204" selected>April</option>
              <option label="May" value="object:205">May</option>
              <option label="June" value="object:203">June</option>
            </select>
            <button class="btn btn-primary srchbtn" type="submit">Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", (event) => {
      event.preventDefault();
      searchClicked += 1;
    });

    const selectResult = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(selectResult.state).toBe("clicked");
    expect(selectResult.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-dashboard-quarter-select-missing",
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "period-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("[name='mon']")?.value).toBe("object:205");

    const searchResult = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(searchResult.state).toBe("clicked");
    expect(searchResult.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-dashboard-quarter-select-missing",
        "gstr2b-return-dashboard-filters-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("re-resolves the live GST dashboard period select after quarter changes rebuild it", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard" data-ng-submit="returnPrd(dropdownValues.finyr,dropdownValues.reqmonth)">
            <label for="fin">Financial Year</label>
            <select name="fin" data-ng-model="dropdownValues.finyr" data-ng-options="item.year for item in years">
              <option label="2026-27" value="object:187" selected>2026-27</option>
              <option label="2025-26" value="object:188">2025-26</option>
            </select>
            <label for="quarter">Quarter</label>
            <select name="quarter" ng-model="dropdownValues.quart" data-ng-options="item.name for item in quarters" ng-change="qtrfunc(quart)">
              <option label="Quarter 1 (Apr - Jun)" value="object:198">Quarter 1 (Apr - Jun)</option>
              <option label="Quarter 2 (Jul - Sep)" value="object:199" selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="mon">Period</label>
            <select name="mon" data-ng-model="dropdownValues.reqmonth" data-ng-options="item.month for item in reqmonths">
              <option label="July" value="object:200" selected>July</option>
            </select>
            <button class="btn btn-primary srchbtn" type="submit">Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", (event) => {
      event.preventDefault();
      searchClicked += 1;
    });
    documentRef
      .querySelector<HTMLSelectElement>("[name='quarter']")
      ?.addEventListener("change", () => {
        const currentPeriod = documentRef.querySelector<HTMLSelectElement>("[name='mon']");
        const nextPeriod = documentRef.createElement("select");
        nextPeriod.name = "mon";
        nextPeriod.setAttribute("data-ng-model", "dropdownValues.reqmonth");
        nextPeriod.innerHTML = `
          <option label="April" value="object:200">April</option>
          <option label="May" value="object:201">May</option>
          <option label="June" value="object:202">June</option>
        `;
        currentPeriod?.replaceWith(nextPeriod);
      });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("[name='quarter']")?.value).toBe(
      "object:198",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[name='mon']")?.value).toBe("object:200");
  });

  it("waits for the live GST dashboard period select when quarter changes rebuild it asynchronously", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard" data-ng-submit="returnPrd(dropdownValues.finyr,dropdownValues.reqmonth)">
            <label for="fin">Financial Year</label>
            <select name="fin" data-ng-model="dropdownValues.finyr" data-ng-options="item.year for item in years">
              <option label="2026-27" value="object:187" selected>2026-27</option>
              <option label="2025-26" value="object:188">2025-26</option>
            </select>
            <label for="quarter">Quarter</label>
            <select name="quarter" ng-model="dropdownValues.quart" data-ng-options="item.name for item in quarters" ng-change="qtrfunc(quart)">
              <option label="Quarter 1 (Apr - Jun)" value="object:198">Quarter 1 (Apr - Jun)</option>
              <option label="Quarter 2 (Jul - Sep)" value="object:199" selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="mon">Period</label>
            <select name="mon" data-ng-model="dropdownValues.reqmonth" data-ng-options="item.month for item in reqmonths">
              <option label="July" value="object:200" selected>July</option>
            </select>
            <button class="btn btn-primary srchbtn" type="submit">Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", (event) => {
      event.preventDefault();
      searchClicked += 1;
    });
    documentRef
      .querySelector<HTMLSelectElement>("[name='quarter']")
      ?.addEventListener("change", () => {
        setTimeout(() => {
          const currentPeriod = documentRef.querySelector<HTMLSelectElement>("[name='mon']");
          const nextPeriod = documentRef.createElement("select");
          nextPeriod.name = "mon";
          nextPeriod.setAttribute("data-ng-model", "dropdownValues.reqmonth");
          nextPeriod.innerHTML = `
            <option label="April" value="object:200">April</option>
            <option label="May" value="object:201">May</option>
            <option label="June" value="object:202">June</option>
          `;
          currentPeriod?.replaceWith(nextPeriod);
        }, 25);
      });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("[name='quarter']")?.value).toBe(
      "object:198",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[name='mon']")?.value).toBe("object:200");
  });

  it("resolves live GST dashboard controls from the dashboard form when page chrome has extra selects", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <select aria-label="Language">
            <option selected>English</option>
          </select>
          <form name="dashboard" data-ng-submit="returnPrd(dropdownValues.finyr,dropdownValues.reqmonth)">
            <select name="fin" data-ng-model="dropdownValues.finyr">
              <option label="2026-27" value="object:187" selected>2026-27</option>
            </select>
            <select name="quarter" data-ng-model="quart" ng-change="qtrfunc(quart)">
              <option label="Quarter 1 (Apr - Jun)" value="object:198">Quarter 1 (Apr - Jun)</option>
              <option label="Quarter 2 (Jul - Sep)" value="object:199" selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <select name="mon" data-ng-model="dropdownValues.reqmonth">
              <option label="May" value="object:201">May</option>
              <option label="July" value="object:200" selected>July</option>
            </select>
            <button class="btn btn-primary srchbtn" type="submit">Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", (event) => {
      event.preventDefault();
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-dashboard-root-found",
        "gstr2b-dashboard-quarter-select-found",
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(
      documentRef.querySelector<HTMLSelectElement>("form[name='dashboard'] [name='quarter']")
        ?.value,
    ).toBe("object:198");
    expect(
      documentRef.querySelector<HTMLSelectElement>("form[name='dashboard'] [name='mon']")?.value,
    ).toBe("object:200");
  });

  it("selects GSTR-2B dashboard filters from ordered selects when labels are not in the root", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <select>
            <option selected>2026-27</option>
          </select>
          <select>
            <option>Quarter 1 (Apr - Jun)</option>
            <option selected>Quarter 2 (Jul - Sep)</option>
          </select>
          <select>
            <option>May</option>
            <option selected>July</option>
          </select>
          <button type="button" data-search>SEARCH</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelectorAll<HTMLSelectElement>("select")[1]?.value).toContain(
      "Quarter 1",
    );
    expect(documentRef.querySelectorAll<HTMLSelectElement>("select")[2]?.value).toBe("July");
  });

  it("selects hidden native GSTR-2B return dashboard filters behind custom portal controls", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <div>
            <select name="finyr" style="display: none">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <select name="quarter" style="display: none">
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <select name="period" style="display: none">
              <option>April</option>
              <option>May</option>
              <option>June</option>
              <option selected>July</option>
            </select>
            <button type="button" data-search>SEARCH</button>
          </div>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("[name='quarter']")?.value).toContain(
      "Quarter 1",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[name='period']")?.value).toBe("July");
  });

  it("opens GSTR-2B from the searched return dashboard card", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <label for="fy">Financial Year</label>
            <select id="fy" name="finyr">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="period">
              <option selected>June</option>
            </select>
            <button type="button">Search</button>
          </form>
          <div class="row">
            <section class="col-sm-4 col-xs-12">
              <h3>Details of outward supplies of goods or services</h3>
              <p>GSTR-1</p>
              <button data-gstr1-view>VIEW</button>
              <button>DOWNLOAD</button>
            </section>
            <section class="col-sm-4 col-xs-12">
              <h3>Auto - drafted ITC Statement for the month</h3>
              <p>GSTR-2B</p>
              <button data-gstr2b-view>VIEW</button>
              <button data-gstr2b-download>DOWNLOAD</button>
            </section>
            <section class="col-sm-4 col-xs-12">
              <h3>Monthly Return</h3>
              <p>GSTR-3B</p>
              <button>VIEW GSTR3B</button>
              <button>DOWNLOAD</button>
            </section>
          </div>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let gstr1Clicked = 0;
    let viewClicked = 0;
    let downloadClicked = 0;
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-download]")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(gstr1Clicked).toBe(0);
    expect(viewClicked).toBe(1);
    expect(downloadClicked).toBe(0);
  });

  it("opens GSTR-2B from the nearest unclassed dashboard card ancestor", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>June</option></select>
            <button type="button">Search</button>
          </form>
          <div>
            <a>Details of outward supplies of goods or services GSTR-1</a>
            <button data-gstr1-view>VIEW</button>
            <button>DOWNLOAD</button>
          </div>
          <div>
            <a>Auto - drafted ITC Statement for the month GSTR-2B</a>
            <button data-gstr2b-view>VIEW</button>
            <button data-gstr2b-download>DOWNLOAD</button>
          </div>
          <div>
            <a>Monthly Return GSTR-3B</a>
            <button>VIEW GSTR3B</button>
            <button>DOWNLOAD</button>
          </div>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let gstr1Clicked = 0;
    let viewClicked = 0;
    let downloadClicked = 0;
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-download]")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(gstr1Clicked).toBe(0);
    expect(viewClicked).toBe(1);
    expect(downloadClicked).toBe(0);
  });

  it("opens GSTR-2B when the live card label and view button are nearby siblings", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option selected>May</option>
            </select>
            <button type="button">Search</button>
          </form>
          <section>
            <div class="hd">
              <p>Auto - drafted ITC Statement for the month</p>
              <p>GSTR-2B</p>
            </div>
            <div class="tile-actions">
              <button data-gstr2b-view>VIEW</button>
              <button>DOWNLOAD</button>
            </div>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(1);
  });

  it("opens the locally scoped GSTR-2B view button from a broad portal dashboard row", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <div class="row">
            <div class="col-sm-4">
              <div class="hd"><p>Details of outward supplies</p><p>GSTR-1</p></div>
              <button data-gstr1-view>View</button>
            </div>
            <div class="col-sm-4">
              <div class="hd">
                <p>Auto - drafted ITC Statement for the month</p>
                <p>GSTR-2B</p>
              </div>
              <div class="ct">
                <div class="row">
                  <div class="col-sm-6">
                    <button data-gstr2b-view data-ng-click="page_rtp(x.return_ty,x.due_dt,x.status)">View</button>
                  </div>
                  <div class="col-sm-5">
                    <button data-ng-click="offlinepath(x.return_ty)">Download</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-sm-4">
              <div class="hd"><p>Monthly Return</p><p>GSTR-3B</p></div>
              <button data-gstr3b-view>View</button>
            </div>
          </div>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let gstr1Clicked = 0;
    let gstr2bClicked = 0;
    let gstr3bClicked = 0;
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      gstr2bClicked += 1;
    });
    documentRef.querySelector("[data-gstr3b-view]")?.addEventListener("click", () => {
      gstr3bClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(gstr1Clicked).toBe(0);
    expect(gstr2bClicked).toBe(1);
    expect(gstr3bClicked).toBe(0);
  });

  it("opens a searched GSTR-2B View when only the quarter label wording drifts", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
              <option>Qtr 1</option>
            </select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector<HTMLSelectElement>("select[name='quarter']")!.value = "Qtr 1";
    const viewResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(viewResult.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(1);
  });

  it("waits on the GSTR-2B app route until summary download controls render", async () => {
    const documentRef = createGstDocument(
      `
        <app-root>
          <h1>GSTR-2B</h1>
          <div class="loader"></div>
        </app-root>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["gstr2b-auth-route", "gstr2b-summary-loading"]),
    );
  });

  it("waits on a blank GSTR-2B summary route instead of treating it as capture-ready", async () => {
    const documentRef = createGstDocument(
      `
        <app-root>
          <div class="loader"></div>
        </app-root>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["gstr2b-auth-route", "gstr2b-summary-loading"]),
    );
    expect(result.safeSignals).not.toContain("gstr2b-download-ready");
  });

  it("returns from a stale GSTR-2B summary page when the visible period does not match", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>April 2026 Auto-drafted ITC Statement</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-summary-period-mismatch",
        "gstr2b-summary-back-clicked",
      ]),
    );
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("rejects incidental GSTR-2B month and year text without labelled scope evidence", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Generated in May for the 2026-27 portal cycle.</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-labelled-period-evidence-missing",
        "gstr2b-summary-period-mismatch",
        "gstr2b-summary-back-clicked",
      ]),
    );
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("accepts the structured GSTR-2B statement identity when labels are absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>May 2026 Auto-drafted ITC Statement</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toContain("gstr2b-visible-period-verified");
  });

  it("accepts the structured GSTR-2B statement identity in a visible div", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <div>May 2026 Auto-drafted ITC Statement</div>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
  });

  it("accepts the split GSTR-2B statement identity when labels are absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Auto-drafted ITC Statement for the month</h1>
          <p>GSTR-2B</p>
          <p>May 2026</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toContain("gstr2b-visible-period-verified");
  });

  it("ignores an unrelated footer date beside a split GSTR-2B statement identity", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Auto-drafted ITC Statement for the month</h1>
          <p>GSTR-2B</p>
          <p>May 2026</p>
          <footer><p>April 2026</p></footer>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
  });

  it("rejects ambiguous split GSTR-2B statement periods", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Auto-drafted ITC Statement for the month</h1>
          <p>GSTR-2B</p>
          <p>April 2026</p>
          <p>May 2026</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.safeSignals).toContain("gstr2b-labelled-period-evidence-missing");
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("rejects accessibility-only GSTR-2B statement period evidence", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Auto-drafted ITC Statement for the month</h1>
          <p>GSTR-2B</p>
          <button aria-label="May 2026"></button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.safeSignals).toContain("gstr2b-labelled-period-evidence-missing");
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("uses the GSTR-2B Back to Dashboard control before browser history for stale summaries", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>May 2026 Auto-drafted ITC Statement</p>
          <button data-back>BACK TO DASHBOARD</button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});
    let dashboardBackClicked = 0;
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      dashboardBackClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-summary-period-mismatch",
        "gstr2b-summary-dashboard-back-clicked",
      ]),
    );
    expect(dashboardBackClicked).toBe(1);
    expect(back).not.toHaveBeenCalled();
  });

  it("trusts explicit GSTR-2B period labels over incidental page month text", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Financial Year - 2025-26</p>
          <p>Return Period - April</p>
          <aside>Quarter 1: April May June</aside>
          <button data-back>BACK TO DASHBOARD</button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    let dashboardBackClicked = 0;
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      dashboardBackClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "June",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-summary-dashboard-back-clicked",
      ]),
    );
    expect(dashboardBackClicked).toBe(1);
  });

  it("uses GSTR-2B server page config to verify the requested summary period", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Auto-drafted ITC Statement</p>
          <aside>Site year 2026-27</aside>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
        <script>
          var server_urls = {
            "FIN_YEAR": "2025-26",
            "RETURN_PERIOD": "052025",
            "FORM_TYPE": "GSTR2B"
          };
        </script>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-summary-route",
        "gstr2b-visible-period-verified",
        "gstr2b-download-ready",
      ]),
    );
  });

  it("rejects GSTR-2B server scope that conflicts with the visible statement", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>April 2025 Auto-drafted ITC Statement</p>
          <button data-back>BACK TO DASHBOARD</button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
        <script>
          var server_urls = {
            "FIN_YEAR": "2025-26",
            "RETURN_PERIOD": "052025",
            "FORM_TYPE": "GSTR2B"
          };
        </script>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    let dashboardBackClicked = 0;
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      dashboardBackClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-server-visible-period-conflict",
        "gstr2b-summary-dashboard-back-clicked",
      ]),
    );
    expect(dashboardBackClicked).toBe(1);
  });

  it("trusts matching explicit GSTR-2B labels over incidental statement text", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Financial Year - 2025-26</p>
          <p>Return Period - May</p>
          <p>April 2025 Auto-drafted ITC Statement</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
        <script>
          var server_urls = {
            "FIN_YEAR": "2025-26",
            "RETURN_PERIOD": "052025",
            "FORM_TYPE": "GSTR2B"
          };
        </script>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toContain("gstr2b-visible-period-verified");
  });

  it("returns from a GSTR-2B summary when server page config identifies another period", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <button data-back>BACK TO DASHBOARD</button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
        <script>
          var server_urls = {
            "FIN_YEAR": "2025-26",
            "RETURN_PERIOD": "042025",
            "FORM_TYPE": "GSTR2B"
          };
        </script>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    let dashboardBackClicked = 0;
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      dashboardBackClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-server-period-mismatch",
        "gstr2b-summary-dashboard-back-clicked",
      ]),
    );
    expect(dashboardBackClicked).toBe(1);
  });

  it("rechecks the visible GSTR-2B period before capturing a portal blob", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Financial Year - 2026-27</p>
          <p>Return Period - April</p>
          <button data-pdf>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    let pdfClicked = 0;
    documentRef.querySelector("[data-pdf]")?.addEventListener("click", () => {
      pdfClicked += 1;
    });

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "action-1",
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.downloadTrigger.state).toBe("blocked");
    expect(result.downloadTrigger.safeSignals).toContain("filed-return-download-target-mismatch");
    expect(result.mainWorldCaptureRequest).toBeUndefined();
    expect(pdfClicked).toBe(0);
  });

  it("reuses GSTR-2B server scope when visible labels are incomplete at capture time", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Auto-drafted ITC Statement</p>
          <aside>Site year 2026-27</aside>
          <button data-pdf>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
        <script>
          var server_urls = {
            "FIN_YEAR": "2025-26",
            "RETURN_PERIOD": "052025",
            "FORM_TYPE": "GSTR2B"
          };
        </script>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "action-server-scope",
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.downloadTrigger).toMatchObject({
      state: "clicked",
      safeSignals: expect.arrayContaining([
        "filed-return-download-clicked",
        "filed-gstr2b-download-clicked",
      ]),
    });
    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "action-server-scope",
      signalPrefix: "filed-gstr2b",
    });
  });

  it("clicks only the requested GSTR-2B details Excel control", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Financial Year - 2026-27</p>
          <p>Return Period - May</p>
          <button data-pdf>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button data-excel>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    let pdfClicked = 0;
    let excelClicked = 0;
    documentRef.querySelector("[data-pdf]")?.addEventListener("click", () => {
      pdfClicked += 1;
    });
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
      const view = documentRef.defaultView;
      if (!view) return;
      const blob = new view.Blob(["PK\u0003\u0004synthetic gstr-2b xlsx"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = view.URL.createObjectURL(blob);
      const anchor = documentRef.createElement("a");
      anchor.href = url;
      anchor.download = "gstr2b.xlsx";
      anchor.click();
    });

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "action-1",
      artifactType: "EXCEL",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.downloadTrigger.state).toBe("clicked");
    expect(result.downloadTrigger.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-download-clicked",
        "filed-gstr2b-download-clicked",
        "filed-gstr2b-portal-blob-download-captured",
        "filed-return-artifact-clicked:EXCEL",
      ]),
    );
    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "action-1",
      controlAttribute: "data-pack-gstr2b-capture-action",
      maxBytes: 36 * 1024 * 1024,
      signalPrefix: "filed-gstr2b",
    });
    expect(pdfClicked).toBe(0);
    expect(excelClicked).toBe(0);
  });

  it("dismisses the GST bank warning with Cancel and does not click File Amendment", async () => {
    const documentRef = createDocument(`
      <main>
        <section class="modal show" role="dialog">
          <p>Please furnish the bank account details before continuing.</p>
          <button data-file-amendment>FILE AMENDMENT</button>
          <button data-cancel>CANCEL</button>
        </section>
        <a data-filed-returns href="/returns/auth/efiledReturns">View Filed Returns</a>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let fileAmendmentClicked = 0;
    let cancelClicked = 0;
    let filedReturnsClicked = 0;
    documentRef.querySelector("[data-file-amendment]")?.addEventListener("click", () => {
      fileAmendmentClicked += 1;
    });
    documentRef.querySelector("[data-cancel]")?.addEventListener("click", () => {
      cancelClicked += 1;
      documentRef.querySelector(".modal")?.remove();
    });
    documentRef.querySelector("[data-filed-returns]")?.addEventListener("click", () => {
      filedReturnsClicked += 1;
    });

    const result = await navigateToFiledReturnsPage(documentRef);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["safe-dialog-dismissed", "dialog-cancel"]),
    );
    expect(fileAmendmentClicked).toBe(0);
    expect(cancelClicked).toBe(1);
    expect(filedReturnsClicked).toBe(1);
  });

  it("dismisses the GST GTA annexure dialog with No and does not click Yes", async () => {
    const documentRef = createDocument(`
      <main>
        <section class="modal show" role="dialog">
          <p>GTA Annexure V declaration is available for this taxpayer.</p>
          <button data-yes>YES</button>
          <button data-no>NO</button>
        </section>
        <a data-filed-returns href="/returns/auth/efiledReturns">View Filed Returns</a>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let yesClicked = 0;
    let noClicked = 0;
    let filedReturnsClicked = 0;
    documentRef.querySelector("[data-yes]")?.addEventListener("click", () => {
      yesClicked += 1;
    });
    documentRef.querySelector("[data-no]")?.addEventListener("click", () => {
      noClicked += 1;
      documentRef.querySelector(".modal")?.remove();
    });
    documentRef.querySelector("[data-filed-returns]")?.addEventListener("click", () => {
      filedReturnsClicked += 1;
    });

    const result = await navigateToFiledReturnsPage(documentRef);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["safe-dialog-dismissed", "dialog-no"]),
    );
    expect(yesClicked).toBe(0);
    expect(noClicked).toBe(1);
    expect(filedReturnsClicked).toBe(1);
  });

  it("extends an expiring GST session with Continue before navigating", async () => {
    const documentRef = createDocument(`
      <main>
        <section class="modal show" role="dialog">
          <h2>Warning</h2>
          <p>Your logged in session will expire in next 02:54 Minutes. Click Continue to extend your session, or click Logout to logout of the application.</p>
          <a data-logout href="/services/logout">Logout</a>
          <button data-continue>Continue</button>
        </section>
        <button data-return-dashboard>Return Dashboard</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let continueClicked = 0;
    let logoutClicked = 0;
    let dashboardClicked = 0;
    documentRef.querySelector("[data-continue]")?.addEventListener("click", () => {
      continueClicked += 1;
      documentRef.querySelector(".modal")?.remove();
    });
    documentRef.querySelector("[data-logout]")?.addEventListener("click", (event) => {
      event.preventDefault();
      logoutClicked += 1;
    });
    documentRef.querySelector("[data-return-dashboard]")?.addEventListener("click", () => {
      dashboardClicked += 1;
    });

    const result = await navigateToFiledReturnsPage(documentRef);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["safe-dialog-dismissed", "dialog-continue"]),
    );
    expect(continueClicked).toBe(1);
    expect(logoutClicked).toBe(0);
    expect(dashboardClicked).toBe(1);
  });

  it("dismisses stacked GST fowelcome reminders before entering Return Dashboard", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section data-aadhaar-reminder>
            <h2>Would you like to Authenticate Aadhaar or Upload E-KYC Documents of Partner/Promoter and Primary Authorized Signatory?</h2>
            <a data-profile>YES, NAVIGATE TO MY PROFILE</a>
            <a data-aadhaar-dismiss>REMIND ME LATER</a>
            <p>Dashboard>My Profile>Aadhaar Authentication Status</p>
          </section>
          <section data-metadata-reminder hidden>
            <h2>GST System is collecting metadata for the Principal Place of Business. Would you like to provide the details now ?</h2>
            <a data-metadata-yes>YES-CLICK HERE</a>
            <a data-metadata-dismiss>NO-REMIND ME LATER</a>
          </section>
          <button data-return-dashboard>RETURN DASHBOARD</button>
        </main>
      `,
      "https://services.gst.gov.in/services/auth/fowelcome",
    );
    makeLayoutVisible(documentRef);
    let profileClicked = 0;
    let metadataYesClicked = 0;
    let aadhaarDismissed = 0;
    let metadataDismissed = 0;
    let returnDashboardClicked = 0;

    documentRef.querySelector("[data-profile]")?.addEventListener("click", () => {
      profileClicked += 1;
    });
    documentRef.querySelector("[data-aadhaar-dismiss]")?.addEventListener("click", () => {
      aadhaarDismissed += 1;
      documentRef.querySelector("[data-aadhaar-reminder]")?.remove();
      documentRef.querySelector("[data-metadata-reminder]")?.removeAttribute("hidden");
    });
    documentRef.querySelector("[data-metadata-yes]")?.addEventListener("click", () => {
      metadataYesClicked += 1;
    });
    documentRef.querySelector("[data-metadata-dismiss]")?.addEventListener("click", () => {
      metadataDismissed += 1;
      documentRef.querySelector("[data-metadata-reminder]")?.remove();
    });
    documentRef.querySelector("[data-return-dashboard]")?.addEventListener("click", () => {
      returnDashboardClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "safe-dialog-dismissed",
        "dialog-remind-later",
        "dialog-no-remind-later",
        "return-dashboard-candidate-clicked",
      ]),
    );
    expect(profileClicked).toBe(0);
    expect(metadataYesClicked).toBe(0);
    expect(aadhaarDismissed).toBe(1);
    expect(metadataDismissed).toBe(1);
    expect(returnDashboardClicked).toBe(1);
  });

  it("uses Services > Returns > View Filed Returns before the Return Dashboard fallback", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <nav>
            <button data-services>Services</button>
            <div data-services-menu hidden>
              <button data-returns>Returns</button>
              <a data-filed-returns hidden href="https://return.gst.gov.in/returns/auth/efiledReturns">View Filed Returns</a>
            </div>
          </nav>
          <button data-return-dashboard>RETURN DASHBOARD</button>
        </main>
      `,
      "https://services.gst.gov.in/services/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let filedReturnsClicked = 0;
    let returnDashboardClicked = 0;

    documentRef.querySelector("[data-services]")?.addEventListener("mouseover", () => {
      documentRef.querySelector("[data-services-menu]")?.removeAttribute("hidden");
    });
    documentRef.querySelector("[data-returns]")?.addEventListener("mouseover", () => {
      documentRef.querySelector("[data-filed-returns]")?.removeAttribute("hidden");
    });
    documentRef.querySelector("[data-filed-returns]")?.addEventListener("click", () => {
      filedReturnsClicked += 1;
    });
    documentRef.querySelector("[data-return-dashboard]")?.addEventListener("click", () => {
      returnDashboardClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-returns-candidate-clicked",
        "after-returns-menu",
        "href-efiledreturns",
      ]),
    );
    expect(result.safeSignals).not.toContain("return-dashboard-candidate-clicked");
    expect(filedReturnsClicked).toBe(1);
    expect(returnDashboardClicked).toBe(0);
  });

  it("uses a hidden portal View Filed Returns menu anchor before Return Dashboard fallback", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <nav>
            <button data-services>Services</button>
            <div data-services-menu hidden>
              <button data-returns>Returns</button>
              <a data-filed-returns hidden href="https://return.gst.gov.in/returns/auth/efiledReturns">View Filed Returns</a>
            </div>
          </nav>
          <button data-return-dashboard>RETURN DASHBOARD</button>
        </main>
      `,
      "https://services.gst.gov.in/services/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let filedReturnsClicked = 0;
    let returnDashboardClicked = 0;

    documentRef.querySelector("[data-filed-returns]")?.addEventListener("click", () => {
      filedReturnsClicked += 1;
    });
    documentRef.querySelector("[data-return-dashboard]")?.addEventListener("click", () => {
      returnDashboardClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "hidden-filed-returns-candidate-clicked",
        "hidden-services-returns-menu",
        "href-efiledreturns",
      ]),
    );
    expect(result.safeSignals).not.toContain("return-dashboard-candidate-clicked");
    expect(filedReturnsClicked).toBe(1);
    expect(returnDashboardClicked).toBe(0);
  });

  it("uses the portal menu from the GST return dashboard instead of replaying the protected URL", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <nav>
            <button data-services>Services</button>
            <div data-services-menu hidden>
              <button data-returns>Returns</button>
              <a data-filed-returns hidden href="https://return.gst.gov.in/returns/auth/efiledReturns">View Filed Returns</a>
            </div>
          </nav>
          <h1>Returns Dashboard</h1>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let filedReturnsClicked = 0;

    documentRef.querySelector("[data-services]")?.addEventListener("mouseover", () => {
      documentRef.querySelector("[data-services-menu]")?.removeAttribute("hidden");
    });
    documentRef.querySelector("[data-returns]")?.addEventListener("mouseover", () => {
      documentRef.querySelector("[data-filed-returns]")?.removeAttribute("hidden");
    });
    documentRef.querySelector("[data-filed-returns]")?.addEventListener("click", () => {
      filedReturnsClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-returns-candidate-clicked",
        "after-returns-menu",
        "href-efiledreturns",
      ]),
    );
    expect(result.safeSignals).not.toContain("return-dashboard-direct-efiledreturns-route");
    expect(filedReturnsClicked).toBe(1);
  });

  it("fails closed on the GST return dashboard when the filed-returns menu candidate is not visible", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <nav>
            <button>Services</button>
            <button>Returns</button>
          </nav>
          <h1>Returns Dashboard</h1>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    const clickedHrefs: string[] = [];
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    documentRef.body.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof view.HTMLAnchorElement) {
        event.preventDefault();
        clickedHrefs.push(target.href);
      }
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["no-filed-returns-candidate"]));
    expect(result.userAction?.type).toBe("NAVIGATE_TO_SUPPORTED_PAGE");
    expect(clickedHrefs).toEqual([]);
  });

  it("does not click a dashboard self-link from the GST return dashboard", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <a data-self-dashboard href="https://return.gst.gov.in/returns/auth/dashboard">Return Dashboard</a>
          <button>Services</button>
          <h1>File Returns</h1>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let dashboardClicked = 0;
    documentRef.querySelector("[data-self-dashboard]")?.addEventListener("click", () => {
      dashboardClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["no-filed-returns-candidate"]));
    expect(result.safeSignals).not.toContain("return-dashboard-candidate-clicked");
    expect(dashboardClicked).toBe(0);
  });

  it("uses the filed-return API before slow dependent dropdown selection on the GST route", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial year</label>
          <select id="finYr"><option>Select</option><option>2026-27</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option>Select</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      </main>
    `);
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    };
    const submittedForms = stubFormSubmit(documentRef);
    stubFiledReturnsApi(documentRef, {
      roleStatus: { userPref: "M" },
      rows: [{ rtntype: "GSTR3B", fy: "2026-27", taxp: "May", arn: "SYNTHETIC", dof: "" }],
    });
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["filed-return-api-result-posted"]));
    expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("Select");
    expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Select");
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe("Select");
    expect(searchClicked).toBe(0);
    expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
  });

  it("uses monthly preference for pre-quarterly GSTR-3B API handoff when role status omits userPref", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial year</label>
          <select id="finYr"><option>Select</option><option>2020-21</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option>Select</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      </main>
    `);
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2020-21",
      period: "December",
      returnType: "GSTR-3B",
    };
    const submittedForms = stubFormSubmit(documentRef);
    stubFiledReturnsApi(documentRef, {
      roleStatus: {},
      rows: [{ rtntype: "GSTR3B", fy: "2020-21", taxp: "December" }],
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["filed-return-api-result-posted"]));
    expect(documentRef.defaultView?.localStorage.getItem("rtn_prd")).toBe("122020");
    expect(documentRef.defaultView?.localStorage.getItem("uPref")).toBe("M");
    expect(documentRef.defaultView?.localStorage.getItem("gstr3bPref")).toBe("M");
    expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
  });

  it("uses the filed-return API when the GST route casing changes", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <form name="efiledReturns">
            <label>Financial year</label>
            <select id="finYr"><option>Select</option><option>2025-26</option></select>
            <label>Return Filing Period</label>
            <select id="optValue"><option>Select</option><option>Monthly</option></select>
            <label>Month</label>
            <select id="month"><option>Select</option></select>
            <label>Return Type</label>
            <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/efiledreturns",
    );
    const submittedForms = stubFormSubmit(documentRef);
    stubFiledReturnsApi(documentRef, {
      roleStatus: { userPref: "M" },
      rows: [{ rtntype: "GSTR3B", fy: "2025-26", taxp: "March", arn: "SYNTHETIC", dof: "" }],
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["filed-return-api-result-posted"]));
    expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
  });

  it("opens filed-return API rows when GST wraps data and varies field names", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial year</label>
          <select id="finYr"><option>Select</option><option>2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option>Select</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      </main>
    `);
    const submittedForms = stubFormSubmit(documentRef);
    stubFiledReturnsApi(documentRef, {
      roleStatus: { data: { userPref: "M" } },
      rows: {
        data: [
          {
            rtnTyp: "GSTR3B",
            financialYear: "2025-26",
            taxPeriod: "March",
            ackNo: "SYNTHETIC",
            dateOfFiling: "18/04/2025",
          },
        ],
      },
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["filed-return-api-result-posted"]));
    expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
    expect(documentRef.defaultView?.localStorage.getItem("rtn_prd")).toBe("032026");
    const efileData = documentRef.defaultView?.localStorage.getItem("efile_data") ?? "";
    expect(efileData).toContain("March");
    expect(efileData).not.toContain("SYNTHETIC");
    expect(efileData).not.toContain("18/04/2025");
  });

  it("falls back to visible filter selection when the GST API returns no matching rows", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select><option>2024-25</option><option>2025-26</option></select>
        <label>Return Filing Period</label>
        <select><option>February</option><option>March</option></select>
        <label>Return Type</label>
        <select><option>GSTR-1</option><option>GSTR-3B</option></select>
        <button>Search</button>
      </main>
    `);
    stubFiledReturnsApi(documentRef, {
      roleStatus: { userPref: "M" },
      rows: [],
    });
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "financial-year-selected",
        "period-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(result.safeSignals).not.toContain("filed-return-api-result-not-found");
    expect(searchClicked).toBe(1);
  });

  it("selects the requested filing filters and clicks search", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select><option>2024-25</option><option>2025-26</option></select>
        <label>Return Filing Period</label>
        <select><option>February</option><option>March</option></select>
        <label>Return Type</label>
        <select><option>GSTR-1</option><option>GSTR-3B</option></select>
        <button>Search</button>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-filters-selected",
        "financial-year-selected",
        "period-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("selects filed GSTR-1 filters without using the GSTR-3B API handoff", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select><option>2024-25</option><option>2025-26</option></select>
        <label>Return Filing Period</label>
        <select><option>February</option><option>March</option></select>
        <label>Return Type</label>
        <select><option>GSTR-1</option><option>GSTR-3B</option></select>
        <button>Search</button>
      </main>
    `);
    stubFiledReturnsApi(documentRef, {
      roleStatus: { userPref: "M" },
      rows: [{ rtntype: "GSTR1", fy: "2025-26", taxp: "March" }],
    });
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.scopeId).toBe("gst-filed-returns-gstr1-pdf-private-v0");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-filters-selected",
        "financial-year-selected",
        "period-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
    expect(documentRef.defaultView?.localStorage.getItem("rtn_prd")).toBeNull();
  });

  it("selects native GST form controls by field label and waits for dependent return types", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <section>
          <div>
            <p>Financial year</p>
            <select data-field="financial-year">
              <option>Select</option>
              <option>2025-26</option>
            </select>
          </div>
          <div>
            <p>Return Filing Period</p>
            <select data-field="period">
              <option>Select</option>
              <option>February</option>
              <option>March</option>
            </select>
          </div>
          <div>
            <p>Return Type</p>
            <select data-field="return-type">
              <option>Select</option>
            </select>
          </div>
          <button data-search>Search</button>
        </section>
      </main>
    `);
    const period = documentRef.querySelector<HTMLSelectElement>("[data-field='period']");
    const returnType = documentRef.querySelector<HTMLSelectElement>("[data-field='return-type']");
    const eventLog: string[] = [];
    let searchClicked = 0;

    for (const field of [period, returnType]) {
      for (const eventName of ["focus", "input", "change", "blur"]) {
        field?.addEventListener(eventName, () => {
          eventLog.push(`${field.dataset.field}:${eventName}`);
        });
      }
    }
    period?.addEventListener("change", () => {
      globalThis.setTimeout(() => {
        const option = documentRef.createElement("option");
        option.textContent = "GSTR-3B";
        option.value = "GSTR-3B";
        returnType?.append(option);
      }, 100);
    });
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(period?.value).toBe("March");
    expect(returnType?.value).toBe("GSTR-3B");
    expect(eventLog).toEqual(
      expect.arrayContaining([
        "period:focus",
        "period:input",
        "period:change",
        "period:blur",
        "return-type:focus",
        "return-type:input",
        "return-type:change",
        "return-type:blur",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("selects the GST filed-returns frequency field before searching for the monthly GSTR-3B row", async () => {
    const documentRef = createDocument(`
      <form name="efiledReturns">
        <h1>View Filed Returns</h1>
        <div>
          <label>Financial year</label>
          <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
            <option>Select</option>
            <option>2026-27</option>
            <option>2025-26</option>
            <option>2024-25</option>
          </select>
        </div>
        <div>
          <label>Return Filing Period</label>
          <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
            <option>Select</option>
            <option>Annual</option>
            <option>Half Yearly</option>
            <option>Quarterly</option>
            <option>Monthly</option>
          </select>
        </div>
        <div>
          <label>Return Type</label>
          <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
            <option>Select</option>
            <option>GSTR1</option>
            <option>GSTR3B</option>
            <option>CMP08</option>
          </select>
        </div>
        <button id="lotsearch" type="button">Search</button>
      </form>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("2025-26");
    expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Monthly");
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe("GSTR3B");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "financial-year-selected",
        "period-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("selects monthly frequency and month before searching for a GSTR-1 row", async () => {
    const mayGstr1Scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createDocument(`
      <form name="efiledReturns">
        <h1>View Filed Returns</h1>
        <div>
          <label>Financial year</label>
          <select id="finYr" title="Select Financial Year">
            <option>Select</option>
            <option value="string:2025-26">2025-26</option>
          </select>
        </div>
        <div>
          <label>Return Filing Period</label>
          <select id="optValue" title="Return Filing Period">
            <option>Select</option>
            <option value="string:Annual">Annual</option>
            <option value="string:Quarterly">Quarterly</option>
            <option value="string:Monthly">Monthly</option>
          </select>
        </div>
        <div>
          <label>Month</label>
          <select id="taxPeriodValue" title="Month">
            <option>Select</option>
            <option value="string:April">April</option>
            <option value="string:May">May</option>
          </select>
        </div>
        <div>
          <label>Return Type</label>
          <select id="retTyp" title="Return Type">
            <option>Select</option>
            <option value="string:GSTR1">GSTR1</option>
            <option value="string:GSTR3B">GSTR3B</option>
          </select>
        </div>
        <button id="lotsearch" type="button">Search</button>
      </form>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, mayGstr1Scope);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("string:Monthly");
    expect(documentRef.querySelector<HTMLSelectElement>("#taxPeriodValue")?.value).toBe(
      "string:May",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe("string:GSTR1");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "period-selected",
        "month-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("selects a visible GST month select by title when the generated id changes", async () => {
    const mayScope: FiledReturnsDownloadScope = {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    };
    const documentRef = createDocument(`
      <form name="efiledReturns">
        <h1>View Filed Returns</h1>
        <div class="row">
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Financial year</label></div>
            <div class="col-sm-12">
              <select id="finYr" title="Select Financial Year" data-ng-model="efiledReturns_financialYear_val">
                <option>Select</option>
                <option value="string:2026-27">2026-27</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Return Filing Period</label></div>
            <div class="col-sm-12">
              <select id="optValue" title="Return Filing Period" data-ng-model="efiledReturns_filingPeriod_val">
                <option>Select</option>
                <option value="string:Monthly">Monthly</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12">Month</div>
            <div class="col-sm-12">
              <select id="taxPeriodValue" title="Month" data-ng-model="efiledReturns_taxPeriod_val">
                <option>Select</option>
                <option value="string:April">April</option>
                <option value="string:May">May</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Return Type</label></div>
            <div class="col-sm-12">
              <select id="retTyp" title="Return Type" data-ng-model="efiledReturns_gstValue_val">
                <option>Select</option>
                <option value="string:GSTR3B">GSTR3B</option>
              </select>
            </div>
          </div>
        </div>
        <button id="lotsearch" type="button">Search</button>
      </form>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, mayScope);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#taxPeriodValue")?.value).toBe(
      "string:May",
    );
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["month-selected", "search-clicked"]),
    );
    expect(searchClicked).toBe(1);
  });

  it("selects the month select between period and return type when GST omits stable month metadata", async () => {
    const mayScope: FiledReturnsDownloadScope = {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    };
    const documentRef = createDocument(`
      <form name="efiledReturns">
        <h1>View Filed Returns</h1>
        <div class="row">
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Financial year</label></div>
            <div class="col-sm-12">
              <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
                <option>Select</option>
                <option value="string:2026-27">2026-27</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Return Filing Period</label></div>
            <div class="col-sm-12">
              <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
                <option>Select</option>
                <option value="string:Monthly">Monthly</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12">Month</div>
            <div class="col-sm-12">
              <select id="periodValue">
                <option>Select</option>
                <option value="string:April">April</option>
                <option value="string:May">May</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Return Type</label></div>
            <div class="col-sm-12">
              <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
                <option>Select</option>
                <option value="string:GSTR3B">GSTR3B</option>
              </select>
            </div>
          </div>
        </div>
        <button id="lotsearch" type="button">Search</button>
      </form>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, mayScope);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#periodValue")?.value).toBe("string:May");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["month-selected", "search-clicked"]),
    );
    expect(searchClicked).toBe(1);
  });

  it("waits for GST Angular controls to repopulate after selecting the financial year", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option>2026-27</option>
              <option>2025-26</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
            </select>
          </div>
          <div>
            <label>Month</label>
            <select id="month" data-ng-model="efiledReturns_month_val">
              <option>Select</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      const financialYear = documentRef.querySelector<HTMLSelectElement>("#finYr");
      const period = documentRef.querySelector<HTMLSelectElement>("#optValue");
      const month = documentRef.querySelector<HTMLSelectElement>("#month");
      const returnType = documentRef.querySelector<HTMLSelectElement>("#retTyp");
      let searchClicked = 0;

      financialYear?.addEventListener("change", () => {
        globalThis.setTimeout(() => {
          appendNativeOption(documentRef, period, "Annual");
          appendNativeOption(documentRef, period, "Monthly");
        }, 1_300);
      });
      period?.addEventListener("change", () => {
        globalThis.setTimeout(() => {
          appendNativeOption(documentRef, month, "February");
          appendNativeOption(documentRef, month, "March");
        }, 1_300);
      });
      month?.addEventListener("change", () => {
        globalThis.setTimeout(() => {
          appendNativeOption(documentRef, returnType, "GSTR1");
          appendNativeOption(documentRef, returnType, "GSTR3B");
        }, 1_300);
      });
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(financialYear?.value).toBe("2025-26");
      expect(period?.value).toBe("Monthly");
      expect(month?.value).toBe("March");
      expect(returnType?.value).toBe("GSTR3B");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "financial-year-selected",
          "period-selected",
          "month-selected",
          "return-type-selected",
          "search-clicked",
        ]),
      );
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries month selection after GST populates month options from return type selection", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2026-27">2026-27</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue">
              <option>Select</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      const scope: FiledReturnsDownloadScope = {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      };
      const returnType = documentRef.querySelector<HTMLSelectElement>("#retTyp");
      let searchClicked = 0;

      returnType?.addEventListener("change", () => {
        globalThis.setTimeout(() => {
          appendNativeOption(
            documentRef,
            documentRef.querySelector<HTMLSelectElement>("#periodValue"),
            "April",
          );
          appendNativeOption(
            documentRef,
            documentRef.querySelector<HTMLSelectElement>("#periodValue"),
            "May",
          );
        }, 1_300);
      });
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, scope);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(documentRef.querySelector<HTMLSelectElement>("#periodValue")?.value).toBe("May");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "financial-year-selected",
          "period-selected",
          "month-selected",
          "return-type-selected",
          "search-clicked",
        ]),
      );
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports available month options when GST keeps the month field unselectable", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2026-27">2026-27</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue">
              <option>Select</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "financial-year-selected",
          "period-selected",
          "return-type-selected",
        ]),
      );
      expect(result.safeSignals).not.toContain("month-selected");
      expect(result.safeMessage).toContain("Missing: month (available options: select).");
      expect(searchClicked).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  it("opens the filed return through the GST API when the month dropdown stays stuck", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2025-26">2025-26</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue" title="Month">
              <option>Select</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      const submittedForms = stubFormSubmit(documentRef);
      stubFiledReturnsApi(documentRef, {
        rows: [
          {
            rtntype: "GSTR3B",
            fy: "2025-26",
            taxp: "March",
            arn: "synthetic-arn",
            dof: "18/04/2025",
          },
        ],
        roleStatus: { userPref: "Q" },
      });
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(45_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-return-api-searched",
          "filed-return-api-result-found",
          "filed-return-api-result-posted",
          "filed-return-result-period:March",
        ]),
      );
      expect(searchClicked).toBe(0);
      expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
      expect(documentRef.defaultView?.localStorage.getItem("rtn_prd")).toBe("032026");
      expect(documentRef.defaultView?.localStorage.getItem("gstr3bPref")).toBe("Q");
      expect(documentRef.defaultView?.sessionStorage.getItem("viewFiled")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  it("falls back to the portal filter flow when API role status is unavailable", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2025-26">2025-26</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue" title="Month">
              <option>Select</option>
              <option value="string:March">March</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      stubFiledReturnsApi(documentRef, {
        rows: [
          {
            rtntype: "GSTR3B",
            fy: "2025-26",
            taxp: "March",
            arn: "synthetic-arn",
            dof: "18/04/2025",
          },
        ],
        roleStatus: null,
      });
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(47_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "financial-year-selected",
          "period-selected",
          "month-selected",
          "return-type-selected",
          "search-clicked",
        ]),
      );
      expect(result.safeSignals).not.toContain("filed-return-api-result-posted");
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  it("uses portal filters instead of defaulting monthly when role status omits user preference", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <label>Financial year</label>
          <select id="finYr"><option>Select</option><option value="string:2025-26">2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option value="string:Monthly">Monthly</option></select>
          <select id="periodValue" title="Month"><option>Select</option><option value="string:March">March</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option value="string:GSTR3B">GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      stubFiledReturnsApi(documentRef, {
        rows: [{ rtntype: "GSTR3B", fy: "2025-26", taxp: "March" }],
        roleStatus: {},
      });
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(47_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(expect.arrayContaining(["search-clicked"]));
      expect(result.safeSignals).not.toContain("filed-return-api-result-posted");
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  it("waits for GST dependent field resets before searching", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2026-27">2026-27</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue" title="Month">
              <option>Select</option>
              <option value="string:May">May</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      const scope: FiledReturnsDownloadScope = {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      };
      const month = documentRef.querySelector<HTMLSelectElement>("#periodValue");
      const returnType = documentRef.querySelector<HTMLSelectElement>("#retTyp");
      let resetReturnType = true;
      let searchClicked = 0;

      month?.addEventListener("change", () => {
        if (!resetReturnType) return;
        resetReturnType = false;
        globalThis.setTimeout(() => {
          if (!returnType) return;
          returnType.value = "Select";
          returnType.selectedIndex = 0;
          returnType.dispatchEvent(new documentRef.defaultView!.Event("change", { bubbles: true }));
        }, 700);
      });
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(month?.value).toBe("string:May");
      expect(returnType?.value).toBe("string:GSTR3B");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "financial-year-selected",
          "period-selected",
          "month-selected",
          "return-type-selected",
          "search-clicked",
        ]),
      );
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the filed GSTR-3B result row for the requested period", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead><tr><th>Return Type</th><th>Financial Year</th><th>Period</th><th>View/Download</th></tr></thead>
          <tbody>
            <tr><td>GSTR-3B</td><td>2024-25</td><td>March</td><td><button>View</button></td></tr>
            <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><a href="#view">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    const gstr1View = documentRef.querySelector("button");
    const gstr3bView = documentRef.querySelector("a");
    let gstr1Clicked = 0;
    let gstr3bClicked = 0;
    gstr1View?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });
    gstr3bView?.addEventListener("click", () => {
      gstr3bClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-view-clicked", "result-row-gstr3b"]),
    );
    expect(gstr1Clicked).toBe(0);
    expect(gstr3bClicked).toBe(1);
  });

  it("automatically clicks only the exact filed GSTR-1 result row once", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-1",
    };
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead><tr><th>Return Type</th><th>Financial Year</th><th>Period</th><th>View/Download</th></tr></thead>
          <tbody>
            <tr><td>GSTR-3B</td><td>2025-26</td><td>March</td><td><button data-gstr3b>View</button></td></tr>
            <tr><td>GSTR1</td><td>2025-26</td><td>March</td><td><button data-gstr1>View</button></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let gstr3bClicked = 0;
    let gstr1Clicked = 0;
    documentRef.querySelector("[data-gstr3b]")?.addEventListener("click", () => {
      gstr3bClicked += 1;
    });
    Object.defineProperty(documentRef.querySelector("[data-gstr1]"), "innerText", {
      configurable: true,
      value: "View",
    });
    documentRef.querySelector("[data-gstr1]")?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });

    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const result = await runFiledReturnsDownloadStep(documentRef, scope);

      expect(result.state).toBe("clicked");
      expect(result.scopeId).toBe("gst-filed-returns-gstr1-pdf-private-v0");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-gstr1-result-view-auto-clicked",
          "filed-return-result-view-clicked",
          "result-row-gstr1",
          "filed-return-result-period:March",
        ]),
      );
      expect(gstr3bClicked).toBe(0);
      expect(gstr1Clicked).toBe(1);

      const pending = await runFiledReturnsDownloadStep(documentRef, scope);
      expect(pending.state).toBe("clicked");
      expect(pending.safeSignals).toContain("filed-gstr1-result-view-navigation-pending");
      expect(gstr1Clicked).toBe(1);

      now.mockReturnValue(4_000);
      const retry = await runFiledReturnsDownloadStep(documentRef, scope);
      expect(retry.state).toBe("user-action-required");
      expect(retry.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-gstr1-result-view-user-action-required",
          "filed-gstr1-result-view-auto-attempt-failed",
        ]),
      );
      expect(retry.userAction).toMatchObject({ canResume: true });
      expect(gstr1Clicked).toBe(1);
    } finally {
      now.mockRestore();
    }
  });

  it("automatically activates a target-bound filed GSTR-1 JavaScript View anchor", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-1",
    };
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead><tr><th>Return Type</th><th>Financial Year</th><th>Period</th><th>View/Download</th></tr></thead>
          <tbody>
            <tr><td>GSTR1</td><td>2025-26</td><td>March</td><td><a data-view href="javascript:void(0)">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let clicked = 0;
    documentRef.querySelector("[data-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-result-view-auto-clicked");
    expect(clicked).toBe(1);
  });

  it("automatically clicks one exact filter-bound GSTR-1 row", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results();
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-result-view-auto-clicked", "result-row-gstr1"]),
    );
    expect(clicked).toBe(1);
  });

  it("resubmits GSTR-1 filters instead of trusting an untracked result row", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results();
    let clicked = 0;
    let searched = 0;
    documentRef.querySelector("button[data-view]")?.addEventListener("click", () => {
      clicked += 1;
    });
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searched += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-filters-selected", "search-clicked"]),
    );
    expect(clicked).toBe(0);
    expect(searched).toBe(1);
  });

  it("waits for one pending GSTR-1 search instead of submitting it again", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0);
    let searched = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searched += 1;
    });
    markFiledReturnsSearchPending(documentRef, scope);

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(hasPendingFiledReturnsSearchForScope(documentRef, scope)).toBe(true);
    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: ["filed-return-search-results-pending"],
    });
    expect(searched).toBe(0);
  });

  it("does not trust a filter-bound GSTR-1 row after the selected period changes", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results();
    markPackSubmittedSearch(documentRef, scope);
    const month = documentRef.querySelector<HTMLSelectElement>("#month");
    if (month) month.value = "May";
    let clicked = 0;
    documentRef.querySelector("button[data-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-result-row-not-found");
    expect(clicked).toBe(0);
  });

  it("blocks ambiguous filter-bound GSTR-1 rows instead of choosing one", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(2);
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    for (const view of Array.from(documentRef.querySelectorAll("button[data-view]"))) {
      view.addEventListener("click", () => {
        clicked += 1;
      });
    }

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toContain("filed-return-result-row-ambiguous");
    expect(clicked).toBe(0);
  });

  it("automatically clicks one exact filter-bound GSTR-1 result card", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr1-result-view-auto-clicked",
        "filed-return-filter-bound-result-view-clicked",
      ]),
    );
    expect(clicked).toBe(1);

    const pending = await runFiledReturnsDownloadStep(documentRef, scope);
    expect(pending.safeSignals).toContain("filed-gstr1-result-view-navigation-pending");
  });

  it("rejects a filter-bound GSTR-1 card with a conflicting explicit period and FY", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    documentRef.querySelector("article")?.append(" Return period: May FY 2024-25");
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-result-row-not-found");
    expect(clicked).toBe(0);
  });

  it("accepts a filter-bound GSTR-1 card with matching explicit period and FY", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    documentRef
      .querySelector("article")
      ?.append(" Return period: Apr FY 2025-26 Filed on 15 May 2025");
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(clicked).toBe(1);
  });

  it("blocks duplicate filter-bound GSTR-1 result cards", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 2);
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    for (const view of Array.from(documentRef.querySelectorAll("button[data-card-view]"))) {
      view.addEventListener("click", () => {
        clicked += 1;
      });
    }

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toContain("filed-return-result-row-ambiguous");
    expect(clicked).toBe(0);
  });

  it("rejects a filter-bound card that mixes GSTR-1 with another return identity", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    documentRef.querySelector("article")?.append(" GSTR-3B");
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-result-row-not-found");
    expect(clicked).toBe(0);
  });

  it("opens the requested row when GST reorders result columns", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead>
            <tr><th>#</th><th>Acknowledgement Number</th><th>Tax Period</th><th>Financial Year</th><th>Return Type</th><th>View/Download</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>AA1</td><td>February</td><td>2025-26</td><td>GSTR3B</td><td><a href="#february">View</a></td></tr>
            <tr><td>2</td><td>AA2</td><td>March</td><td>2025-26</td><td>GSTR3B</td><td><a href="#march">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    const marchView = documentRef.querySelector<HTMLAnchorElement>("a[href='#march']");
    const februaryView = documentRef.querySelector<HTMLAnchorElement>("a[href='#february']");
    let marchClicked = 0;
    let februaryClicked = 0;
    marchView?.addEventListener("click", () => {
      marchClicked += 1;
    });
    februaryView?.addEventListener("click", () => {
      februaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-result-view-clicked",
        "filed-return-result-period:March",
      ]),
    );
    expect(marchClicked).toBe(1);
    expect(februaryClicked).toBe(0);
  });

  it("blocks duplicate matching result rows instead of guessing which period to open", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead>
            <tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>Acknowledgement Number</th><th>View/Download</th></tr>
          </thead>
          <tbody>
            <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td>AA1</td><td><a href="#first">View</a></td></tr>
            <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td>AA2</td><td><a href="#second">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let clicked = 0;
    for (const link of Array.from(documentRef.querySelectorAll("a"))) {
      link.addEventListener("click", () => {
        clicked += 1;
      });
    }

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-row-ambiguous"]),
    );
    expect(clicked).toBe(0);
  });

  it("treats a settled no-records result as positive not-filed evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result).toMatchObject({
      state: "candidate-not-found",
      safeSignals: expect.arrayContaining(["filed-return-positively-not-filed"]),
    });
    expect(result.safeSignals).not.toContain("filed-return-result-row-not-found");
  });

  it("checks no-record evidence before reselecting an already matching filter form", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select id="finYr"><option selected>2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option selected>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option selected>March</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
    expect(searchClicked).toBe(0);
  });

  it("does not treat stale hidden no-record text as positive not-filed evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p style="display: none">No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not treat no-record text while loading as positive not-filed evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results" aria-busy="true">
          <p>Loading...</p>
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not treat no-record text inside an outer busy result panel as not-filed", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <table>
            <tbody>
              <tr><td>No records found</td></tr>
            </tbody>
          </table>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
    documentRef.querySelector("section")?.setAttribute("aria-busy", "true");

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not mark not-filed when a matching result row exists with a no-record footer", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <table>
            <thead><tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>View/Download</th></tr></thead>
            <tbody>
              <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><a href="#view">View</a></td></tr>
            </tbody>
          </table>
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    let viewClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-view-clicked"]),
    );
    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
    expect(viewClicked).toBe(1);
  });

  it("does not mark not-filed when a matching result row exists outside the no-record panel", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Prior result status">
          <p>No records found</p>
        </section>
        <section aria-label="Search results">
          <table>
            <thead><tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>View/Download</th></tr></thead>
            <tbody>
              <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><a href="#view">View</a></td></tr>
            </tbody>
          </table>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    let viewClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-view-clicked"]),
    );
    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
    expect(viewClicked).toBe(1);
  });

  it("does not mark not-filed when a matching result row has an accessible icon action", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Prior result status">
          <p>No records found</p>
        </section>
        <section aria-label="Search results">
          <table>
            <thead><tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>View/Download</th></tr></thead>
            <tbody>
              <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><button aria-label="View"></button></td></tr>
            </tbody>
          </table>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    let viewClicked = 0;
    documentRef.querySelector("button[aria-label='View']")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-view-clicked"]),
    );
    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
    expect(viewClicked).toBe(1);
  });

  it("does not mark not-filed when a matching result row has no actionable view control", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Prior result status">
          <p>No records found</p>
        </section>
        <section aria-label="Search results">
          <table>
            <thead><tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>View/Download</th></tr></thead>
            <tbody>
              <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><button disabled>Open</button></td></tr>
            </tbody>
          </table>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("opens result rows whose tax period uses a GST month abbreviation", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead><tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>View/Download</th></tr></thead>
          <tbody>
            <tr><td>GSTR3B</td><td>2025-26</td><td>Mar</td><td><a href="#view">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let viewClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-result-view-clicked",
        "filed-return-result-period:March",
      ]),
    );
    expect(viewClicked).toBe(1);
  });

  it("opens headerless result rows whose tax period uses a GST month abbreviation", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <caption>View/Download</caption>
          <tbody>
            <tr><td>GSTR3B</td><td>2025-26</td><td>Mar</td><td><a href="#view">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let viewClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-result-view-clicked",
        "filed-return-result-period:March",
      ]),
    );
    expect(viewClicked).toBe(1);
  });

  it("verifies native month selection before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>February</option><option>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("accepts native abbreviated month selection before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>Mar</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
  });

  it("verifies custom month selection before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div><label>Financial Year</label><select id="finYr"><option selected>2025-26</option></select></div>
          <div><label>Return Filing Period</label><select id="optValue"><option selected>Monthly</option></select></div>
          <div><span>Month</span><button type="button" data-month>March</button></div>
          <div><label>Return Type</label><select id="retTyp"><option selected>GSTR3B</option></select></div>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
  });

  it("accepts custom September abbreviation before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div><label>Financial Year</label><select id="finYr"><option selected>2025-26</option></select></div>
          <div><label>Return Filing Period</label><select id="optValue"><option selected>Monthly</option></select></div>
          <div><span>Month</span><button type="button" data-month>Sept</button></div>
          <div><label>Return Type</label><select id="retTyp"><option selected>GSTR3B</option></select></div>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, {
      ...DEFAULT_SCOPE,
      period: "September",
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      ...DEFAULT_SCOPE,
      period: "September",
    });

    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
  });

  it("rejects no-record evidence when the custom month selection differs", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div><label>Financial Year</label><select id="finYr"><option selected>2025-26</option></select></div>
          <div><label>Return Filing Period</label><select id="optValue"><option selected>Monthly</option></select></div>
          <div><span>Month</span><button type="button" data-month>February</button></div>
          <div><label>Return Type</label><select id="retTyp"><option selected>GSTR3B</option></select></div>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("requires a present month control before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not mark not-filed from a stale no-record panel without a submitted-search marker", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not mark not-filed from a stale no-record panel before the search result settles", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <main>
          <h1>View Filed Returns</h1>
          <form name="efiledReturns">
            <label>Financial Year</label>
            <select id="finYr"><option selected>2025-26</option></select>
            <label>Return Filing Period</label>
            <select id="optValue"><option selected>Monthly</option></select>
            <label>Month</label>
            <select id="month"><option selected>March</option></select>
            <label>Return Type</label>
            <select id="retTyp"><option selected>GSTR3B</option></select>
            <button id="lotsearch" type="button">Search</button>
          </form>
          <section aria-label="Search results">
            <p>No records found</p>
          </section>
        </main>
      `);

      const firstResultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const firstResult = await firstResultPromise;
      const secondResultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const secondResult = await secondResultPromise;

      expect(firstResult.state).toBe("clicked");
      expect(secondResult.safeSignals).not.toContain("filed-return-positively-not-filed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark not-filed when unrelated pre-search loading disappears without result changes", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <main>
          <h1>View Filed Returns</h1>
          <form name="efiledReturns">
            <label>Financial Year</label>
            <select id="finYr"><option selected>2025-26</option></select>
            <label>Return Filing Period</label>
            <select id="optValue"><option selected>Monthly</option></select>
            <label>Month</label>
            <select id="month"><option selected>March</option></select>
            <label>Return Type</label>
            <select id="retTyp"><option selected>GSTR3B</option></select>
            <button id="lotsearch" type="button">Search</button>
          </form>
          <div data-unrelated-loading>Loading...</div>
          <section aria-label="Search results">
            <p>No records found</p>
          </section>
        </main>
      `);

      const firstResultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const firstResult = await firstResultPromise;
      documentRef.querySelector("[data-unrelated-loading]")?.remove();
      const secondResultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const secondResult = await secondResultPromise;

      expect(firstResult.state).toBe("clicked");
      expect(secondResult.safeSignals).not.toContain("filed-return-positively-not-filed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not settle a stale no-record search from unrelated post-click page loading", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    const unrelatedLoading = documentRef.createElement("div");
    unrelatedLoading.setAttribute("aria-busy", "true");
    unrelatedLoading.textContent = "Loading...";
    documentRef.body.append(unrelatedLoading);

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    unrelatedLoading.remove();
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
  });

  it("does not settle a plain no-record section from unrelated body mutations", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section>
          <p>No records found</p>
        </section>
      </main>
    `);

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    const unrelatedStatus = documentRef.createElement("aside");
    unrelatedStatus.textContent = "Search finished elsewhere";
    documentRef.body.append(unrelatedStatus);

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
  });

  it("does not settle when result-surface loading leaves the same no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    const resultSurface = documentRef.querySelector("section");

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    resultSurface?.setAttribute("aria-busy", "true");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    resultSurface?.removeAttribute("aria-busy");

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasUnchangedFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-search-results-unchanged");
    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
    expect(hasPendingFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
  });

  it("makes unchanged GSTR-2B search results explicitly retryable", async () => {
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B",
    };
    const documentRef = createGstDocument(`
      <main>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected></option></select>
          <select id="retTyp"><option selected>GSTR-2B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results"><p>No records found</p></section>
      </main>
    `);
    const resultSurface = documentRef.querySelector("section");

    markFiledReturnsSearchPending(documentRef, scope);
    resultSurface?.setAttribute("aria-busy", "true");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
    resultSurface?.removeAttribute("aria-busy");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("gstr2b-filed-return-search-results-unchanged");
    expect(hasPendingFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
  });

  it("settles an identical refresh only after the same scope previously settled", async () => {
    const documentRef = createDocument(`
      <main>
        <section aria-label="Search results"><p>No records found</p></section>
      </main>
    `);
    const resultSurface = documentRef.querySelector("section");

    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
    consumeSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE);

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    resultSurface?.setAttribute("aria-busy", "true");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    resultSurface?.removeAttribute("aria-busy");

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
  });

  it("expires same-scope identical-refresh trust", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <main><section aria-label="Search results"><p>No records found</p></section></main>
      `);
      const resultSurface = documentRef.querySelector("section");

      markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
      expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
      consumeSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(30_001);

      markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
      resultSurface?.setAttribute("aria-busy", "true");
      expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
      resultSurface?.removeAttribute("aria-busy");
      expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
      expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
      expect(hasUnchangedFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
      await vi.advanceTimersByTimeAsync(120_001);
      expect(hasUnchangedFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles when a post-loading result changes text without changing its shape", async () => {
    const documentRef = createDocument(`
      <main>
        <section aria-label="Search results">
          <table><tbody><tr><td data-period>May</td><td>Filed</td><td><button>View</button></td></tr></tbody></table>
        </section>
      </main>
    `);
    const resultSurface = documentRef.querySelector("section");

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    resultSurface?.setAttribute("aria-busy", "true");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    resultSurface?.removeAttribute("aria-busy");
    const period = documentRef.querySelector("[data-period]");
    if (period) period.textContent = "Apr";

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
  });

  it("settles when the filed-return result container is replaced with identical no-record content", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    const oldSurface = documentRef.querySelector("section");
    const replacement = documentRef.createElement("section");
    replacement.setAttribute("aria-label", "Search results");
    replacement.innerHTML = "<p>No records found</p>";

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    oldSurface?.replaceWith(replacement);

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
  });

  it("consumes settled not-filed evidence after returning a terminal result", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const firstResult = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
    const secondResult = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(firstResult.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
    expect(secondResult.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not reuse settled not-filed evidence after a new refresh starts", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
    documentRef.querySelector("section")?.setAttribute("aria-busy", "true");

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("rejects no-record evidence when the scoped month differs despite a stale global match", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Month</label>
        <select data-stale-month><option selected>March</option></select>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>February</option><option>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("accepts no-record evidence when the scoped month matches despite a stale global mismatch", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Month</label>
        <select data-stale-month><option selected>February</option></select>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
  });

  it("rejects no-record evidence when visible scoped month controls conflict", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <label>Month</label>
          <select data-first-month><option selected>March</option></select>
          <label>Tax Period</label>
          <select data-second-month><option selected>February</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("allows one unambiguous global field when no filed-return form field exists", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select><option selected>2025-26</option></select>
        <label>Return Filing Period</label>
        <select><option selected>Monthly</option></select>
        <label>Month</label>
        <select><option selected>March</option></select>
        <label>Return Type</label>
        <select><option selected>GSTR3B</option></select>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
  });

  it("rejects no-record evidence when fallback global fields conflict", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select><option selected>2025-26</option></select>
        <label>Return Filing Period</label>
        <select><option selected>Monthly</option></select>
        <label>Month</label>
        <select id="month"><option selected>March</option></select>
        <label>Month</label>
        <select><option selected>February</option></select>
        <label>Return Type</label>
        <select><option selected>GSTR3B</option></select>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not mark not-filed from non-filed-returns GST pages", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>Other GST Search</h1>
        <form>
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("scopes the final search click to the filed-return filter form", async () => {
    const documentRef = createDocument(`
      <main>
        <button data-unrelated-search type="button">Search</button>
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr"><option>Select</option><option>2025-26</option></select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue"><option>Select</option><option>Monthly</option></select>
          </div>
          <div>
            <label>Month</label>
            <select id="month"><option>Select</option><option>March</option></select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          </div>
          <input id="lotsearch" type="button" value="Search" />
        </form>
      </main>
    `);
    let unrelatedClicked = 0;
    let formSearchClicked = 0;
    documentRef.querySelector("[data-unrelated-search]")?.addEventListener("click", () => {
      unrelatedClicked += 1;
    });
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      formSearchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["financial-year-selected", "month-selected", "search-clicked"]),
    );
    expect(unrelatedClicked).toBe(0);
    expect(formSearchClicked).toBe(1);
  });

  it("preflights the filed PDF download without clicking from the retryable step", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr3b-download-ready",
        "filed-return-detail-period:March",
        "filed-return-detail-financial-year:2025-26",
      ]),
    );
    expect(downloadClicked).toBe(0);
  });

  it("dismisses the GST summary overlay even when it is not marked as a modal", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns / GSTR-3B</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button data-download>DOWNLOAD FILED GSTR-3B</button>
        <section data-summary-overlay>
          <h2>System generated summary for GSTR-3B:</h2>
          <table><tbody><tr><td>Summary status</td><td>Yes</td></tr></tbody></table>
          <button data-close>CLOSE</button>
        </section>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let downloadClicked = 0;
    documentRef.querySelector("[data-download]")?.addEventListener("click", () => {
      downloadClicked += 1;
    });
    documentRef.querySelector("[data-close]")?.addEventListener("click", () => {
      documentRef.querySelector("[data-summary-overlay]")?.remove();
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr3b-download-ready",
        "filed-return-detail-period:March",
        "filed-return-detail-financial-year:2025-26",
      ]),
    );
    expect(documentRef.querySelector("[data-summary-overlay]")).toBeNull();
    expect(downloadClicked).toBe(0);
  });

  it("returns a retryable block without mutating a portal-owned summary overlay", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns / GSTR-3B</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button data-download>DOWNLOAD FILED GSTR-3B</button>
        <section class="modal show" style="display:block">
          <h2>System generated summary for GSTR-3B:</h2>
          <button aria-label="Close">x</button>
        </section>
        <div class="modal-backdrop show"></div>
      </main>
    `);
    makeLayoutVisible(documentRef);
    documentRef.body.classList.add("modal-open");
    const modal = documentRef.querySelector<HTMLElement>(".modal");
    const backdrop = documentRef.querySelector<HTMLElement>(".modal-backdrop");
    const modalStyle = modal?.getAttribute("style");

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "detail-summary-modal-close-blocked",
        "detail-summary-modal",
      ]),
      userAction: { type: "WAIT_FOR_PORTAL_AVAILABILITY", canResume: true },
    });
    expect(modal?.isConnected).toBe(true);
    expect(modal?.getAttribute("style")).toBe(modalStyle);
    expect(documentRef.body.classList.contains("modal-open")).toBe(true);
    expect(backdrop?.isConnected).toBe(true);
  });

  it("parses colon and line-separated detail identity from the download detail component", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <aside>
          <p>Financial Year - 2024-25</p>
          <p>Return Period - February</p>
        </aside>
        <section>
          <h1>GSTR-3B - Monthly Return</h1>
          <div>Status - Filed</div>
          <dl>
            <dt>Financial Year:</dt>
            <dd>2025-26</dd>
            <dt>Return Period</dt>
            <dd>March</dd>
          </dl>
          <button>DOWNLOAD FILED GSTR-3B</button>
        </section>
      </main>
    `);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-detail-period:March",
        "filed-return-detail-financial-year:2025-26",
      ]),
    );
    expect(result.safeSignals).not.toContain("filed-return-detail-period:February");
    expect(result.safeSignals).not.toContain("filed-return-detail-financial-year:2024-25");
  });

  it("canonicalizes abbreviated detail periods before declaring the download ready", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - Mar</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-detail-period:March",
        "filed-return-detail-financial-year:2025-26",
      ]),
    );
  });

  it("canonicalizes September detail abbreviations before declaring the download ready", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - Sept</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      ...DEFAULT_SCOPE,
      period: "September",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-detail-period:September",
        "filed-return-detail-financial-year:2025-26",
      ]),
    );
  });

  it("captures an explicit filed GSTR-3B PDF download when the detail period is abbreviated", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - Mar</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.downloadTrigger.state).toBe("clicked");
    expect(result.downloadTrigger.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-download-clicked",
        "filed-gstr3b-download-clicked",
        "filed-gstr3b-portal-blob-download-captured",
        "filed-gstr3b-extension-download-requested",
        "filed-return-artifact-clicked:PDF",
      ]),
    );
    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "test-action",
      signalPrefix: "filed-gstr3b",
      timeoutMs: 5_000,
    });
    expect(downloadClicked).toBe(0);
  });

  it("clicks the verified GSTR-3B portal control when capture falls back", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      forcePortalClick: true,
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.downloadTrigger.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-download-clicked", "filed-gstr3b-download-clicked"]),
    );
    expect(result.mainWorldCaptureRequest).toBeUndefined();
    expect(downloadClicked).toBe(1);
  });

  it("does not trigger a GSTR-3B download while the portal summary overlay remains open", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button data-download>DOWNLOAD FILED GSTR-3B</button>
        <section class="modal show" style="display:block">
          <h2>System generated summary for GSTR-3B:</h2>
          <button aria-label="Close">x</button>
        </section>
        <div class="modal-backdrop show"></div>
      </main>
    `);
    makeLayoutVisible(documentRef);
    documentRef.body.classList.add("modal-open");
    const modal = documentRef.querySelector<HTMLElement>(".modal");
    const backdrop = documentRef.querySelector<HTMLElement>(".modal-backdrop");
    let closeClicked = 0;
    let downloadClicked = 0;
    documentRef.querySelector("[aria-label='Close']")?.addEventListener("click", () => {
      closeClicked += 1;
    });
    documentRef.querySelector("[data-download]")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.downloadTrigger).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining(["detail-summary-modal-close-blocked"]),
      userAction: { type: "WAIT_FOR_PORTAL_AVAILABILITY", canResume: true },
    });
    expect(closeClicked).toBe(1);
    expect(downloadClicked).toBe(0);
    expect(modal?.isConnected).toBe(true);
    expect(documentRef.body.classList.contains("modal-open")).toBe(true);
    expect(backdrop?.isConnected).toBe(true);
  });

  it("captures an explicit filed GSTR-1 PDF download before any portal click", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-1</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button>DOWNLOAD FILED GSTR-1</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-1",
    });

    expect(result.downloadTrigger.state).toBe("clicked");
    expect(result.downloadTrigger.scopeId).toBe("gst-filed-returns-gstr1-pdf-private-v0");
    expect(result.downloadTrigger.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-download-clicked",
        "filed-gstr1-download-clicked",
        "filed-gstr1-portal-blob-download-captured",
        "filed-gstr1-extension-download-requested",
      ]),
    );
    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "test-action",
      signalPrefix: "filed-gstr1",
      timeoutMs: 15_000,
    });
    expect(downloadClicked).toBe(0);
  });

  it.each(["PDF", "EXCEL"] as const)(
    "captures an explicit filed GSTR-2B %s download before any portal click",
    async (artifactType) => {
      const documentRef = createGstr2bSummaryDocument();
      let pdfClicked = 0;
      let excelClicked = 0;
      const buttons = documentRef.querySelectorAll("button");
      buttons[0]?.addEventListener("click", () => {
        pdfClicked += 1;
      });
      buttons[1]?.addEventListener("click", () => {
        excelClicked += 1;
      });

      const result = await triggerFiledReturnDownload(documentRef, {
        actionId: `test-gstr2b-${artifactType.toLowerCase()}`,
        artifactType,
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      });

      expect(result.downloadTrigger.state).toBe("clicked");
      expect(result.downloadTrigger.scopeId).toBe("gst-gstr2b-private-v0");
      expect(result.downloadTrigger.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-return-download-clicked",
          "filed-gstr2b-download-clicked",
          "filed-gstr2b-portal-blob-download-captured",
          "filed-gstr2b-extension-download-requested",
          `filed-return-artifact-clicked:${artifactType}`,
        ]),
      );
      expect(result.mainWorldCaptureRequest).toMatchObject({
        actionId: `test-gstr2b-${artifactType.toLowerCase()}`,
        signalPrefix: "filed-gstr2b",
      });
      expect(pdfClicked).toBe(0);
      expect(excelClicked).toBe(0);
    },
  );

  it("treats the filed GSTR-1 View Summary page as PDF-download ready", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <nav>Returns / Filed Returns</nav>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr1-download-ready",
        "filed-return-detail-period:May",
        "filed-return-detail-financial-year:2025-26",
        "filed-return-detail-type:GSTR-1",
      ]),
    );
  });

  it("captures the filed GSTR-1 View Summary PDF before any portal click", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <nav>Returns / Filed Returns</nav>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button>
            DOWNLOAD (PDF)
            DOWNLOAD SUMMARY (PDF)
            Click here to download GSTR-1 summary for all tax periods in PDF format.
          </button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );
    makeLayoutVisible(documentRef);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.downloadTrigger.state).toBe("clicked");
    expect(result.downloadTrigger.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr1-detail-route",
        "download-pdf-gstr1-visible",
        "filed-return-download-clicked",
        "text-download-pdf-gstr1",
        "filed-gstr1-portal-blob-download-captured",
        "filed-gstr1-extension-download-requested",
      ]),
    );
    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "test-action",
      signalPrefix: "filed-gstr1",
      timeoutMs: 15_000,
    });
    expect(downloadClicked).toBe(0);
  });

  it("returns from the filed GSTR-1 View Summary page before an Excel-only trigger", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <nav>Returns / Filed Returns</nav>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );
    makeLayoutVisible(documentRef);
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-summary-back-clicked"]),
    );
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("returns from a filed GSTR-1 summary when the requested period changes", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );
    makeLayoutVisible(documentRef);
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: ["filed-gstr1-summary-period-mismatch", "filed-gstr1-summary-back-clicked"],
    });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("prefers portal navigation over history when switching from a prior GSTR-1 summary", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <a data-filed-returns>View Filed Returns</a>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );
    makeLayoutVisible(documentRef);
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);
    let filedReturnsClicked = 0;
    documentRef.querySelector("[data-filed-returns]")?.addEventListener("click", () => {
      filedReturnsClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr1-scope-switch-navigation",
        "filed-returns-candidate-clicked",
      ]),
    );
    expect(filedReturnsClicked).toBe(1);
    expect(back).not.toHaveBeenCalled();
  });

  it("prefers portal navigation over Back when switching from a prior GSTR-1 detail", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <a data-filed-returns>View Filed Returns</a>
          <h1>GSTR-1</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button data-back>BACK</button>
          <button>Download Details from E-Invoices (Excel)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    makeLayoutVisible(documentRef);
    let filedReturnsClicked = 0;
    let backClicked = 0;
    documentRef.querySelector("[data-filed-returns]")?.addEventListener("click", () => {
      filedReturnsClicked += 1;
    });
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      backClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr1-scope-switch-navigation",
        "filed-returns-candidate-clicked",
      ]),
    );
    expect(filedReturnsClicked).toBe(1);
    expect(backClicked).toBe(0);
  });

  it("does not leave a filed GSTR-1 summary for the requested period", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - April</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum/",
    );
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toContain("filed-return-download-ready");
    expect(back).not.toHaveBeenCalled();
  });

  it("does not leave a filed GSTR-1 summary when its visible scope is incomplete", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("ready");
    expect(back).not.toHaveBeenCalled();
  });

  it("captures an explicit filed GSTR-1 e-invoice details Excel before any portal click", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-1</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - May</div>
        <button data-pdf>DOWNLOAD FILED GSTR-1</button>
        <button data-excel>Download Details from E-Invoices (Excel)</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let pdfClicked = 0;
    let excelClicked = 0;
    documentRef.querySelector("[data-pdf]")?.addEventListener("click", () => {
      pdfClicked += 1;
    });
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
    });

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "test-action",
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.downloadTrigger.state).toBe("clicked");
    expect(result.downloadTrigger.scopeId).toBe("gst-filed-returns-gstr1-pdf-private-v0");
    expect(result.downloadTrigger.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-download-clicked",
        "filed-gstr1-download-clicked",
        "text-download-excel-gstr1",
        "filed-gstr1-portal-blob-download-captured",
        "filed-gstr1-extension-download-requested",
      ]),
    );
    expect(result.mainWorldCaptureRequest).toMatchObject({
      actionId: "test-action",
      signalPrefix: "filed-gstr1",
      timeoutMs: 15_000,
    });
    expect(pdfClicked).toBe(0);
    expect(excelClicked).toBe(0);
  });

  it("classifies the GSTR-1 e-invoice no-details modal after the capture click", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-1</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - May</div>
        <button data-excel>Download Details from E-Invoices (Excel)</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let excelClicked = 0;
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
      globalThis.setTimeout(() => {
        const modal = documentRef.createElement("section");
        modal.setAttribute("role", "dialog");
        modal.innerHTML = `
          <h2>Information</h2>
          <p>No details available for download (This is relevant only if you have reported e-invoices).</p>
          <button>OK</button>
        `;
        documentRef.body.append(modal);
      }, 400);
    });

    const target = {
      actionId: "test-action",
      artifactType: "EXCEL" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1" as const,
    };
    documentRef.querySelector<HTMLElement>("[data-excel]")?.click();
    await new Promise((resolve) => globalThis.setTimeout(resolve, 450));
    const result = detectPostClickBlockedState(documentRef, target, [
      "filed-return-download-clicked",
      "filed-gstr1-download-clicked",
    ]);

    expect(result?.state).toBe("blocked");
    expect(result?.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-download-clicked",
        "filed-gstr1-download-clicked",
        "filed-gstr1-excel-no-details-available",
      ]),
    );
    expect(excelClicked).toBe(1);
  });

  it("refuses to click GSTR-1 e-invoice Excel controls until filed status is visible", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-1</h1>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - May</div>
        <button>Download Details from E-Invoices (Excel)</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let excelClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      excelClicked += 1;
    });

    const result = await triggerFiledReturnFiledPdfDownload(documentRef, {
      actionId: "test-action",
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-download-status-not-filed"]),
    );
    expect(excelClicked).toBe(0);
  });

  it("reports a filed GSTR-1 detail page when no download files are available yet", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <nav>Returns / Filed Returns</nav>
          <h1>GSTR-1</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <section>
            <h2>E-Invoice Download History</h2>
            <p>No files available for download</p>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );

    const result = await triggerFiledReturnFiledPdfDownload(documentRef, {
      actionId: "test-action",
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr1-detail-route",
        "status-filed",
        "no-files-available-for-download",
        "filed-gstr1-download-candidate-not-found",
      ]),
    );
    expect(result.safeSignals).not.toContain("not-filed-gstr1-detail-page");
  });

  it("refuses to click a GSTR-3B detail page for a GSTR-1 target", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await triggerFiledReturnFiledPdfDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("candidate-not-found");
    expect(result.scopeId).toBe("gst-filed-returns-gstr1-pdf-private-v0");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["not-filed-gstr1-detail-page"]));
    expect(downloadClicked).toBe(0);
  });

  it("refuses an explicit trigger when the detail page identity does not match the target", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - February</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const trigger = triggerFiledGstr3bFiledPdfDownload as unknown as (
      documentRef: Document,
      target: {
        actionId: string;
        financialYear: string;
        period: string;
        returnType: "GSTR-3B";
      },
    ) => ReturnType<typeof triggerFiledGstr3bFiledPdfDownload>;

    const result = await trigger(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-detail-period:February",
        "filed-return-download-target-mismatch",
      ]),
    );
    expect(downloadClicked).toBe(0);
  });

  it("refuses an explicit trigger when the detail page has duplicate visible download controls", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button data-primary>DOWNLOAD FILED GSTR-3B</button>
        <button data-secondary>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let clicked = 0;
    for (const button of Array.from(documentRef.querySelectorAll("button"))) {
      button.addEventListener("click", () => {
        clicked += 1;
      });
    }

    const trigger = triggerFiledGstr3bFiledPdfDownload as unknown as (
      documentRef: Document,
      target: {
        actionId: string;
        financialYear: string;
        period: string;
        returnType: "GSTR-3B";
      },
    ) => ReturnType<typeof triggerFiledGstr3bFiledPdfDownload>;

    const result = await trigger(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr3b-download-candidate-ambiguous"]),
    );
    expect(clicked).toBe(0);
  });

  it("returns from a mismatched detail page before running the requested exact period", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button>BACK</button>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    let backClicked = 0;
    let downloadClicked = 0;
    const [backButton, downloadButton] = Array.from(documentRef.querySelectorAll("button"));
    backButton?.addEventListener("click", () => {
      backClicked += 1;
    });
    downloadButton?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      ...DEFAULT_SCOPE,
      period: "February",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-detail-back-clicked"]),
    );
    expect(backClicked).toBe(1);
    expect(downloadClicked).toBe(0);
  });

  it("handles scoped custom dropdown controls without leaving the filter form", async () => {
    const documentRef = createDocument(`
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
    `);
    makeLayoutVisible(documentRef);
    const period = documentRef.querySelector<HTMLElement>("[data-field='period']");
    const returnType = documentRef.querySelector<HTMLElement>("[data-field='return-type']");
    let searchClicked = 0;

    period?.addEventListener("click", () => {
      appendOption(documentRef, "March", () => {
        period.textContent = "March";
      });
    });
    returnType?.addEventListener("click", () => {
      appendOption(documentRef, "GSTR-3B", () => {
        returnType.textContent = "GSTR-3B";
      });
    });
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "financial-year-selected",
        "period-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("does not choose a matching custom option from an unrelated page overlay", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <button data-unrelated-option role="option">Monthly</button>
        <section>
          <div>
            <span>Financial Year</span>
            <button data-field="financial-year">2025-26</button>
          </div>
          <div>
            <span>Return Filing Period</span>
            <button data-field="period" aria-controls="period-options">Select</button>
          </div>
          <div>
            <span>Return Type</span>
            <button data-field="return-type" aria-controls="return-type-options">Select</button>
          </div>
          <button data-search>Search</button>
        </section>
      </main>
    `);
    makeLayoutVisible(documentRef);
    const period = documentRef.querySelector<HTMLElement>("[data-field='period']");
    const returnType = documentRef.querySelector<HTMLElement>("[data-field='return-type']");
    let unrelatedClicked = 0;
    let searchClicked = 0;

    documentRef.querySelector("[data-unrelated-option]")?.addEventListener("click", () => {
      unrelatedClicked += 1;
    });
    period?.addEventListener("click", () => {
      appendOwnedOption(documentRef, "period-options", "March", () => {
        period.textContent = "March";
      });
    });
    returnType?.addEventListener("click", () => {
      appendOwnedOption(documentRef, "return-type-options", "GSTR-3B", () => {
        returnType.textContent = "GSTR-3B";
      });
    });
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["period-selected", "return-type-selected", "search-clicked"]),
    );
    expect(unrelatedClicked).toBe(0);
    expect(searchClicked).toBe(1);
  });

  it("continues past an earlier labelled select that does not contain the requested option", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select data-stale-fy><option>2024-25</option></select>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select id="finYr"><option>Select</option><option>2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option>Select</option><option>March</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("2025-26");
    expect(searchClicked).toBe(1);
  });

  it("does not click unrelated controls when the filter widgets cannot be resolved", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <button data-logout>Logout</button>
        <section>
          <p>
            To view records, click Search post selection of Financial Year and
            Return Type. Please do not select any value in Return Filing Period.
          </p>
          <button data-search>Search</button>
        </section>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let logoutClicked = 0;
    documentRef.querySelector("[data-logout]")?.addEventListener("click", () => {
      logoutClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("candidate-not-found");
    expect(logoutClicked).toBe(0);
  });

  it("selects GSTR-1 filing period when the page instruction belongs to unrelated forms", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <main>
          <h1>View Filed Returns</h1>
          <p>
            To view the filed GST ITC-01/02A/03 forms, please click on Search post selection of
            Financial Year and Return Type. Please do not select any value in Return Filing Period.
          </p>
          <form name="efiledReturns">
            <label>Financial Year</label>
            <select id="finYr"><option>Select</option><option>2026-27</option></select>
            <label>Return Filing Period</label>
            <select id="optValue"><option>Select</option><option>Monthly</option></select>
            <label>Month</label>
            <select id="month"><option>Select</option><option>May</option></select>
            <label>Return Type</label>
            <select id="retTyp"><option>Select</option><option>GSTR-1/IFF/GSTR-1A</option></select>
            <button id="lotsearch" type="button">Search</button>
          </form>
        </main>
      `);
      const scope: FiledReturnsDownloadScope = {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-1",
      };
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "financial-year-selected",
          "period-selected",
          "month-selected",
          "return-type-selected",
          "search-clicked",
        ]),
      );
      expect(result.safeSignals).not.toContain("return-filing-period-left-unselected");
      expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("2026-27");
      expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Monthly");
      expect(documentRef.querySelector<HTMLSelectElement>("#month")?.value).toBe("May");
      expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe(
        "GSTR-1/IFF/GSTR-1A",
      );
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a stale isolated-world filing period when GSTR-2B requires it blank", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(`
        <main>
          <h1>View Filed Returns</h1>
          <p>For GSTR-2B, please do not select any value in Return Filing Period.</p>
          <form name="efiledReturns">
            <label>Financial Year</label>
            <select id="finYr"><option>Select</option><option>2026-27</option></select>
            <label>Return Filing Period</label>
            <select id="optValue"><option>Select</option><option selected>Monthly</option></select>
            <label>Return Type</label>
            <select id="retTyp"><option>Select</option><option>GSTR-2B</option></select>
            <button id="lotsearch" type="button">Search</button>
          </form>
        </main>
      `);
      const scope: FiledReturnsDownloadScope = {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      };
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toContain("return-filing-period-left-unselected");
      expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Select");
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects stable GST native selects when labels and selects are split across columns", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div class="row">
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Financial year</label></div>
              <div class="col-sm-12">
                <select id="finYr">
                  <option value="string:Select">Select</option>
                  <option value="string:2025-26">2025-26</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Return Filing Period</label></div>
              <div class="col-sm-12">
                <select id="optValue">
                  <option value="string:Select">Select</option>
                  <option value="string:Monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Return Type</label></div>
              <div class="col-sm-12">
                <select id="retTyp">
                  <option value="string:Select">Select</option>
                  <option value="string:GSTR3B">GSTR3B</option>
                </select>
              </div>
            </div>
          </div>
        </form>
        <button id="lotsearch" type="button">Search</button>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("string:2025-26");
    expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("string:Monthly");
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe("string:GSTR3B");
    expect(searchClicked).toBe(1);
  });

  it("clicks search when the live GSTR-1 filter form is already populated", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div class="row">
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Financial year</label></div>
              <div class="col-sm-12">
                <select id="finYr">
                  <option value="string:Select">Select</option>
                  <option selected value="string:2025-26">2025-26</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Return Filing Period</label></div>
              <div class="col-sm-12">
                <select id="optValue">
                  <option value="string:Select">Select</option>
                  <option selected value="string:Monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Month</label></div>
              <div class="col-sm-12">
                <select id="month">
                  <option value="string:Select">Select</option>
                  <option selected value="string:May">May</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Return Type</label></div>
              <div class="col-sm-12">
                <select id="retTyp">
                  <option value="string:Select">Select</option>
                  <option selected value="string:GSTR1">GSTR-1/IFF/GSTR-1A</option>
                </select>
              </div>
            </div>
          </div>
        </form>
        <button id="lotsearch" type="button">Search</button>
      </main>
    `);
    Object.defineProperty(documentRef.querySelector("#lotsearch"), "innerText", {
      configurable: true,
      value: "Search",
    });
    const gstr1Scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "financial-year-selected",
        "period-selected",
        "month-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("opens the filed GSTR-1 View Summary page before the PDF download", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <h2>GSTR-1</h2>
          <section>
            <p>Return Type - GSTR-1</p>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">VIEW SUMMARY PROCEED TO FILE/SUMMARY</button>
            <button data-excel type="button">Download details of E-invoices in Excel</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    let excelClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-summary-view-clicked"]),
    );
    expect(summaryClicked).toBe(1);
    expect(excelClicked).toBe(0);
  });

  it("waits for GSTR-1 View Summary instead of treating an early Excel control as PDF-ready", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Status - Filed</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - April</p>
          <button data-excel type="button">Download details of E-invoices in Excel</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/dashboard",
    );
    let excelClicked = 0;
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual([
      "filed-gstr1-target-bound-detail",
      "filed-gstr1-summary-view-pending",
    ]);
    expect(excelClicked).toBe(0);
  });

  it("opens GSTR-1 View Summary when the detail page has no Excel control", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <h2>GSTR-1</h2>
          <section>
            <p>Return Type - GSTR-1</p>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">VIEW SUMMARY PROCEED TO FILE/SUMMARY</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(1);
  });

  it("opens GSTR-1 View Summary on a target-bound portal detail subroute", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Status - Filed</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - April</p>
          <button data-summary type="button">VIEW SUMMARY</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/dashboard",
    );
    let summaryClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(1);
  });

  it("opens a GSTR-1 View Summary input control on the detail page", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Status - Filed</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - May</p>
          <input data-summary type="button" value="VIEW SUMMARY" />
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(1);
  });

  it("opens a GSTR-1 View Summary JavaScript anchor without running its URL", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Status - Filed</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - May</p>
          <a data-summary href="javascript:void(0)">VIEW SUMMARY</a>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    let defaultPrevented = false;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", (event) => {
      summaryClicked += 1;
      defaultPrevented = event.defaultPrevented;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(1);
    expect(defaultPrevented).toBe(true);
  });

  it("opens the filed GSTR-1 View Summary page before a combined PDF and Excel run", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <h2>GSTR-1</h2>
          <section>
            <p>Return Type - GSTR-1</p>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">VIEW SUMMARY PROCEED TO FILE/SUMMARY</button>
            <button data-excel type="button">Download details of E-invoices in Excel</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    let excelClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-summary-view-clicked"]),
    );
    expect(summaryClicked).toBe(1);
    expect(excelClicked).toBe(0);
  });

  it("uses the filed GSTR-1 route as return-type evidence before View Summary navigation", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Filed return detail</h1>
          <section>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">VIEW SUMMARY PROCEED TO FILE/SUMMARY</button>
            <button data-excel type="button">Download details of E-invoices in Excel</button>
            <button data-back type="button">Back</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    let backClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      backClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-summary-view-clicked"]),
    );
    expect(summaryClicked).toBe(1);
    expect(backClicked).toBe(0);
  });

  it("does not leave the filed GSTR-1 detail page before an Excel-only run", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <h2>GSTR-1</h2>
          <section>
            <p>Return Type - GSTR-1</p>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">View Summary</button>
            <button data-excel type="button">Download details of E-invoices in Excel</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("ready");
    expect(result.safeSignals).not.toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(0);
  });

  it("waits for a target-bound GSTR-1 Excel control instead of blocking immediately", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Return Type - GSTR-1</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - May</p>
          <p>Status - Filed</p>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: ["filed-gstr1-target-bound-detail", "filed-gstr1-excel-control-pending"],
    });
  });

  it("prefers filed-return form selects before matching controls elsewhere on the page", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <aside>
          <select id="finYr" data-outside-financial-year>
            <option>Select</option>
            <option>2025-26</option>
          </select>
          <select id="optValue" data-outside-period>
            <option>Select</option>
            <option>Monthly</option>
          </select>
          <select id="retTyp" data-outside-return-type>
            <option>Select</option>
            <option>GSTR3B</option>
          </select>
        </aside>
        <form name="efiledReturns">
          <div>
            <label>Financial year</label>
            <select data-form-financial-year>
              <option>Select</option>
              <option>2025-26</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select data-form-period>
              <option>Select</option>
              <option>Monthly</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select data-form-return-type>
              <option>Select</option>
              <option>GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("[data-form-financial-year]")?.value).toBe(
      "2025-26",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[data-form-period]")?.value).toBe(
      "Monthly",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[data-form-return-type]")?.value).toBe(
      "GSTR3B",
    );
    expect(
      documentRef.querySelector<HTMLSelectElement>("[data-outside-financial-year]")?.value,
    ).toBe("Select");
    expect(documentRef.querySelector<HTMLSelectElement>("[data-outside-period]")?.value).toBe(
      "Select",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[data-outside-return-type]")?.value).toBe(
      "Select",
    );
    expect(searchClicked).toBe(1);
  });

  it("does not change unrelated native selects outside the filed-return form", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <aside>
          <select data-unrelated>
            <option>Select</option>
            <option>March</option>
          </select>
        </aside>
        <section>
          <p>Financial Year</p>
          <p>Return Filing Period</p>
          <p>Return Type</p>
          <button data-search>Search</button>
        </section>
      </main>
    `);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("candidate-not-found");
    expect(documentRef.querySelector<HTMLSelectElement>("[data-unrelated]")?.value).toBe("Select");
  });
});

function createDocument(body: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
  }).window.document;
}

function createGstDocument(
  body: string,
  url = "https://return.gst.gov.in/returns/auth/efiledReturns",
): Document {
  const options: Record<string, unknown> = {
    pretendToBeVisual: true,
    url,
  };
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, options).window.document;
}

function createGstr2bSummaryDocument(extraBody = ""): Document {
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

function makeLayoutVisible(documentRef: Document) {
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

function appendOption(documentRef: Document, text: string, onClick: () => void) {
  const option = documentRef.createElement("button");
  option.setAttribute("role", "option");
  option.textContent = text;
  option.addEventListener("click", () => {
    onClick();
    option.remove();
  });
  documentRef.body.append(option);
}

function appendOwnedOption(documentRef: Document, id: string, text: string, onClick: () => void) {
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

function replaceGstr2bDashboardView(documentRef: Document): void {
  const previousView = findGstr2bDashboardControl(documentRef, "view");
  expect(previousView).not.toBeNull();
  if (!previousView) return;
  const replacement = previousView.cloneNode(true) as HTMLElement;
  replacement.addEventListener("click", () => previousView.click());
  previousView.replaceWith(replacement);
}

function appendNativeOption(documentRef: Document, select: HTMLSelectElement | null, text: string) {
  const option = documentRef.createElement("option");
  option.textContent = text;
  option.value = text;
  select?.append(option);
}

function stubFiledReturnsApi(
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

function stubFormSubmit(documentRef: Document): Array<{ action: string; method: string }> {
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

function markPackSubmittedSearch(documentRef: Document, scope: FiledReturnsDownloadScope) {
  const settledContainers = detachSettledResults(documentRef);
  markFiledReturnsSearchPending(documentRef, scope);
  for (const container of settledContainers) {
    container.parent.append(container.element);
  }
  expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
  expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
}

function createFilterBoundGstr1Results(rowCount = 1, cardCount = 0): Document {
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

function detachSettledResults(documentRef: Document): Array<{ parent: Element; element: Element }> {
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

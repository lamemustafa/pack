import { describe, expect, it } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import { FILED_RETURN_ROUTE_MISMATCH_SIGNALS } from "../../src/connectors/gst/filed-returns-durable-signals";
import { filedReturnScopeId } from "../../src/connectors/gst/filed-returns-return-descriptors";
import { navigateToFiledReturnsPage } from "../../src/connectors/gst/filed-returns-navigator";
import {
  DEFAULT_SCOPE,
  createDocument,
  createGstDocument,
  makeLayoutVisible,
  stubFiledReturnsApi,
} from "./filed-returns-flow.test-helpers";

describe("filed returns flow — navigation and routing", () => {
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

  it.each([
    ["GSTR-1", "GSTR-3B", "filed-returns"],
    ["GSTR-1", "GSTR-2B", "return-dashboard"],
    ["GSTR-3B", "GSTR-1", "return-dashboard"],
    ["GSTR-3B", "GSTR-2B", "return-dashboard"],
    ["GSTR-2B", "GSTR-1", "return-dashboard"],
    ["GSTR-2B", "GSTR-3B", "filed-returns"],
  ] as const)(
    "leaves a visible %s page for the requested %s destination",
    async (visibleReturnType, returnType, expectedNavigation) => {
      const visibleUrl =
        visibleReturnType === "GSTR-2B"
          ? "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary"
          : `https://return.gst.gov.in/returns/auth/${visibleReturnType === "GSTR-1" ? "gstr1" : "gstr3b"}`;
      const documentRef = createGstDocument(
        `<main>
          <h1>Filed ${visibleReturnType}</h1>
          <button>Download Filed ${visibleReturnType}</button>
          <nav>
            <a data-filed-returns href="/returns/auth/efiledReturns">View Filed Returns</a>
            <a data-return-dashboard href="/returns/auth/dashboard">Return Dashboard</a>
          </nav>
        </main>`,
        visibleUrl,
      );
      makeLayoutVisible(documentRef);
      const clicked = { filedReturns: 0, returnDashboard: 0 };
      documentRef.querySelector("[data-filed-returns]")?.addEventListener("click", (event) => {
        event.preventDefault();
        clicked.filedReturns += 1;
      });
      documentRef.querySelector("[data-return-dashboard]")?.addEventListener("click", (event) => {
        event.preventDefault();
        clicked.returnDashboard += 1;
      });

      const result = await runFiledReturnsDownloadStep(documentRef, {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType,
      });

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toContain(FILED_RETURN_ROUTE_MISMATCH_SIGNALS[visibleReturnType]);
      expect(result.safeSignals).toContain(
        expectedNavigation === "filed-returns"
          ? "filed-returns-candidate-clicked"
          : "return-dashboard-candidate-clicked",
      );
      expect(result.safeMessage).toContain(visibleReturnType);
      expect(result.safeMessage).toContain(returnType);
      expect(clicked).toEqual(
        expectedNavigation === "filed-returns"
          ? { filedReturns: 1, returnDashboard: 0 }
          : { filedReturns: 0, returnDashboard: 1 },
      );
    },
  );

  it("fails closed with both return types when mismatched-page navigation is unavailable", async () => {
    const documentRef = createGstDocument(
      "<main><h1>Filed GSTR-1</h1><button>Download Filed GSTR-1</button></main>",
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    makeLayoutVisible(documentRef);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-3B",
    });

    expect(result.state).toBe("candidate-not-found");
    expect(result.userAction?.type).toBe("NAVIGATE_TO_SUPPORTED_PAGE");
    expect(result.safeMessage).toContain("GSTR-1");
    expect(result.safeMessage).toContain("GSTR-3B");
  });

  it("keeps GSTR-2B login evidence ahead of mismatched-page navigation", async () => {
    const documentRef = createGstDocument(
      `<main>
        <h1>Login</h1>
        <label>Username</label><input />
        <label>Captcha</label><input />
        <button>Login</button>
        <a data-dashboard href="/returns/auth/dashboard">Return Dashboard</a>
      </main>`,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    makeLayoutVisible(documentRef);
    let dashboardClicked = 0;
    documentRef.querySelector("[data-dashboard]")?.addEventListener("click", () => {
      dashboardClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("login-required");
    expect(result.userAction?.type).toBe("LOGIN");
    expect(dashboardClicked).toBe(0);
  });

  it("waits for a GSTR-2B session dialog before mismatched-page navigation", async () => {
    const documentRef = createGstDocument(
      `<main>
        <section class="modal show" role="dialog">
          <p>Your logged in session will expire soon. Click Continue to extend your session, or click Logout.</p>
          <a data-logout href="/services/logout">Logout</a>
          <button data-continue>Continue</button>
        </section>
        <div class="modal-backdrop show"></div>
        <h1>Filed GSTR-1</h1>
        <a data-dashboard href="/returns/auth/dashboard">Return Dashboard</a>
      </main>`,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    makeLayoutVisible(documentRef);
    let dashboardClicked = 0;
    documentRef.querySelector("[data-dashboard]")?.addEventListener("click", () => {
      dashboardClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["safe-dialog-still-visible", "gstr2b-dialog-dismissal-waiting"]),
    );
    expect(result.safeSignals).not.toContain(FILED_RETURN_ROUTE_MISMATCH_SIGNALS["GSTR-1"]);
    expect(dashboardClicked).toBe(0);
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

  it("leaves View Filed Returns for the GSTR-1 Return Dashboard route", async () => {
    const documentRef = createGstDocument(`
      <main>
        <a data-dashboard href="/returns/auth/dashboard">Returns Dashboard</a>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label><select><option>2026-27</option></select>
          <label>Return Filing Period</label><select><option>Monthly</option></select>
          <label>Return Type</label><select><option>GSTR-1</option></select>
          <button type="button">Search</button>
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
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: expect.arrayContaining([
        "gstr1-filed-returns-route-mismatched",
        "return-dashboard-candidate-clicked",
      ]),
    });
    expect(dashboardClicked).toBe(1);
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

  it("does not reuse the filed-returns form as a GSTR-1 navigation shortcut", async () => {
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

    expect(result.state).toBe("candidate-not-found");
    expect(result.scopeId).toBe("gst-filed-returns-gstr1-pdf-private-v0");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr1-filed-returns-route-mismatched",
        "no-return-dashboard-candidate",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.defaultView?.localStorage.getItem("rtn_prd")).toBeNull();
  });
});

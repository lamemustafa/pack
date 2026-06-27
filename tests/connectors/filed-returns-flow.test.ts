import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/core/contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import { triggerFiledGstr3bFiledPdfDownload } from "../../src/connectors/gst/filed-returns-download";
import { navigateToFiledReturnsPage } from "../../src/connectors/gst/filed-returns-navigator";
import {
  hasSettledFiledReturnsSearchForScope,
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
      await vi.advanceTimersByTimeAsync(12_000);
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
      await vi.advanceTimersByTimeAsync(45_000);
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

  it("stops with a clear action when the GST API finds a row but role status is unavailable", async () => {
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

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(47_000);
      const result = await resultPromise;

      expect(result.state).toBe("user-action-required");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-return-api-searched",
          "filed-return-api-result-found",
          "filed-return-api-result-role-status-unavailable",
        ]),
      );
      expect(result.userAction?.canResume).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  it("blocks API detail handoff when role status omits user preference", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <label>Financial year</label>
          <select id="finYr"><option>Select</option><option value="string:2025-26">2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option value="string:Monthly">Monthly</option></select>
          <select id="periodValue" title="Month"><option>Select</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option value="string:GSTR3B">GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      stubFiledReturnsApi(documentRef, {
        rows: [{ rtntype: "GSTR3B", fy: "2025-26", taxp: "March" }],
        roleStatus: {},
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(47_000);
      const result = await resultPromise;

      expect(result.state).toBe("user-action-required");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-return-api-result-found",
          "filed-return-api-result-role-status-unavailable",
        ]),
      );
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

  it("settles when the filed-return result surface enters and exits busy with the same no-record text", async () => {
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

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
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

  it("clicks an explicit filed PDF download when the detail period is abbreviated", async () => {
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

    const result = await triggerFiledGstr3bFiledPdfDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["filed-gstr3b-download-clicked"]));
    expect(downloadClicked).toBe(1);
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

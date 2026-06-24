import { describe, expect, it } from "vitest";
import { observeFiledReturnsPageText } from "../../src/connectors/gst/filed-returns-observer";

describe("filed returns private observer", () => {
  it("does not mark generic PDF controls as filed GSTR-3B readiness", () => {
    const observation = observeFiledReturnsPageText(`
      View Filed Returns
      Financial Year 2023-24
      Return Filing Period APR
      GSTR-3B
      Filed
      Download
      PDF
    `);

    expect(observation.state).toBe("download-not-visible");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining(["filed-returns-heading", "gstr-3b", "filed", "download", "pdf"]),
    );
    expect(observation.userAction).toBeUndefined();
  });

  it("marks the page ready when the explicit filed GSTR-3B download control is visible", () => {
    const observation = observeFiledReturnsPageText(`
      View Filed Returns
      GSTR-3B - Monthly Return
      Status - Filed
      DOWNLOAD FILED GSTR-3B
    `);

    expect(observation.state).toBe("ready");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining(["filed-returns-heading", "gstr-3b", "download-filed-gstr-3b"]),
    );
    expect(observation.userAction).toBeUndefined();
  });

  it("does not classify the GST home due-date PDF as filed-return readiness", () => {
    const observation = observeFiledReturnsPageText(`
      Goods and Services Tax
      Upcoming Due Dates DOWNLOAD PDF
      GSTR-3B (May, 2026)
    `);

    expect(observation.state).toBe("wrong-page");
    expect(observation.safeSignals).toEqual(expect.arrayContaining(["gstr-3b", "download", "pdf"]));
    expect(observation.safeSignals).not.toContain("download-filed-gstr-3b");
  });

  it("marks the initial filed-returns filter form as requiring filters", () => {
    const observation = observeFiledReturnsPageText(`
      View Filed Returns
      Financial Year
      Return Filing Period
      Return Type
      GSTR-1
      GSTR-3B
      Search
    `);

    expect(observation.state).toBe("filters-required");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining(["filed-returns-heading", "filter-form", "search-action"]),
    );
  });

  it("marks the filed returns result table as requiring a row view before PDF readiness", () => {
    const observation = observeFiledReturnsPageText(`
      View Filed Returns
      Financial Year
      Return Filing Period
      Return Type
      Return Type
      Financial Year
      Tax Period
      Acknowledgement Number
      Date of filing
      Mode of filing
      Filed By
      View/Download
      GSTR3B
      View
    `);

    expect(observation.state).toBe("filed-return-results-visible");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining(["gstr-3b", "view-download-column", "view-action"]),
    );
  });

  it("marks the filed GSTR-3B detail page as blocked while the summary modal is open", () => {
    const observation = observeFiledReturnsPageText(
      `
      GSTR-3B - Monthly Return
      Status - Filed
      DOWNLOAD FILED GSTR-3B
      SYSTEM GENERATED GSTR-3B
      System generated summary for GSTR-3B
      Close
    `,
      { pathname: "/returns/auth/gstr3b" },
    );

    expect(observation.state).toBe("detail-summary-modal-open");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr-3b-detail-route",
        "download-filed-gstr-3b",
        "detail-summary-modal",
      ]),
    );
  });

  it("marks the filed GSTR-3B detail page as ready when final controls are visible", () => {
    const observation = observeFiledReturnsPageText(
      `
      GSTR-3B - Monthly Return
      Status - Filed
      DOWNLOAD FILED GSTR-3B
      SYSTEM GENERATED GSTR-3B
    `,
      { pathname: "/returns/auth/gstr3b" },
    );

    expect(observation.state).toBe("ready");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining(["gstr-3b-detail-route", "download-filed-gstr-3b"]),
    );
  });

  it("asks the user to log in without exposing portal text", () => {
    const observation = observeFiledReturnsPageText(`
      Goods and Services Tax
      Login
      Username
      Password
      CAPTCHA
    `);

    expect(observation.state).toBe("login-required");
    expect(observation.userAction?.type).toBe("LOGIN");
    expect(JSON.stringify(observation)).not.toMatch(/password|captcha/i);
  });

  it("does not treat authenticated Last Login text as a login requirement", () => {
    const observation = observeFiledReturnsPageText(`
      View Filed Returns
      Last Login: 24/06/2026
      Financial Year
      Return Filing Period
      Return Type
      GSTR-3B
      Search
    `);

    expect(observation.state).toBe("filters-required");
    expect(observation.safeSignals).not.toContain("login");
  });

  it("redacts sensitive identifiers from safe diagnostic labels", () => {
    const observation = observeFiledReturnsPageText(`
      View Filed Returns
      29ABCDE1234F1Z5
      ARN AA2901234567890
      GSTR-3B Filed Download PDF
    `);

    expect(JSON.stringify(observation)).not.toContain("29ABCDE1234F1Z5");
    expect(JSON.stringify(observation)).not.toContain("AA2901234567890");
  });

  it("recognises the live e-filed returns route even when text is sparse", () => {
    const observation = observeFiledReturnsPageText("Returns dashboard", {
      pathname: "/pages/returns/efiledreturns.html",
      requestPathShapes: [
        "/pages/returns/efiledreturns.html",
        "/master/gstrs/Y",
        "/master/fy/2025-26",
      ],
    });

    expect(observation.state).toBe("page-settling");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining(["filed-returns-route", "filed-returns-heading"]),
    );
  });

  it("recognises the authenticated e-filed returns route variant as filed returns", () => {
    const observation = observeFiledReturnsPageText(
      `
      Financial Year
      Return Filing Period
      Return Type
      GSTR-3B
      Search
    `,
      { pathname: "/returns/auth/efiledReturns" },
    );

    expect(observation.state).toBe("filters-required");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining(["filed-returns-route", "filed-returns-heading", "filter-form"]),
    );
  });

  it("treats the authenticated filed-return route with stale landing text as settling", () => {
    const observation = observeFiledReturnsPageText(
      `
      Welcome to GST Common Portal
      Returns Calendar
      GSTR-3B
      Jan Filed
      Feb Filed
    `,
      { pathname: "/returns/auth/efiledReturns" },
    );

    expect(observation.state).toBe("page-settling");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining(["filed-returns-route", "filed-returns-heading", "gstr-3b"]),
    );
  });

  it("treats sparse authenticated filed-return filter forms as requiring filters", () => {
    const observation = observeFiledReturnsPageText(
      `
      View Filed Returns
      Financial year
      Return Filing Period
      Return Type
      Search
    `,
      { pathname: "/returns/auth/efiledReturns" },
    );

    expect(observation.state).toBe("filters-required");
    expect(observation.safeSignals).toEqual(
      expect.arrayContaining(["filed-returns-route", "filed-returns-heading", "filter-form"]),
    );
  });
});

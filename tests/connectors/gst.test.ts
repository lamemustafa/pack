import { describe, expect, it } from "vitest";
import { detectGstPortalContext } from "../../src/connectors/gst/detect";
import {
  FILED_RETURNS_PRIVATE_SPIKE_SCOPE,
  createFiledReturnsPrivateSpikePlan,
  createGstReturnPlan,
} from "../../src/connectors/gst/planner";

describe("GST connector", () => {
  it("detects supported GST return pages", () => {
    const url = new URL("https://return.gst.gov.in/returns/auth/dashboard");
    const context = detectGstPortalContext(url as unknown as Location, "GST Returns");

    expect(context.supported).toBe(true);
    expect(context.pageKind).toBe("supported-gst-return-page");
    expect(context.origin).toBe("https://return.gst.gov.in");
  });

  it("treats an authenticated fowelcome dashboard as usable portal context", () => {
    const url = new URL("https://services.gst.gov.in/services/auth/fowelcome");
    const context = detectGstPortalContext(
      url as unknown as Location,
      "Goods and Services Tax",
      "Last logged in on 01/01/2026\nReturns Calendar (Last 5 return periods)\nWelcome Example Trading Private Limited to GST Common Portal",
    );

    expect(context).toMatchObject({
      supported: true,
      pageKind: "supported-gst-return-page",
      origin: "https://services.gst.gov.in",
    });
  });

  it("keeps an empty fowelcome shell as sign-in required", () => {
    const url = new URL("https://services.gst.gov.in/services/auth/fowelcome");
    const context = detectGstPortalContext(url as unknown as Location, "Goods and Services Tax");

    expect(context.supported).toBe(true);
    expect(context.pageKind).toBe("gst-auth-landing");
    expect(context.requiredAction).toBeUndefined();
  });

  it("detects the filed returns area as the first private live scope", () => {
    const url = new URL("https://services.gst.gov.in/services/auth/returns/view-filed-returns");
    const context = detectGstPortalContext(url as unknown as Location, "View Filed Returns");

    expect(context.supported).toBe(true);
    expect(context.pageKind).toBe("gst-filed-returns");
    expect(context.safeTitle).toBeUndefined();
  });

  it("recognizes the authenticated Returns quick-links hub as usable navigation context", () => {
    const url = new URL("https://services.gst.gov.in/services/auth/quicklinks/returns");
    const context = detectGstPortalContext(url as unknown as Location, "Returns Quick Links");

    expect(context).toMatchObject({
      connectorId: "gst",
      supported: true,
      origin: "https://services.gst.gov.in",
      pageKind: "gst-portal",
    });
  });

  it("recognizes the authenticated services dashboard as usable navigation context", () => {
    const url = new URL("https://services.gst.gov.in/services/auth/dashboard");
    const context = detectGstPortalContext(url as unknown as Location, "GST Dashboard");

    expect(context).toMatchObject({
      connectorId: "gst",
      supported: true,
      origin: "https://services.gst.gov.in",
      pageKind: "gst-portal",
    });
  });

  it("detects the filed GSTR-3B detail page as part of the private live scope", () => {
    const url = new URL("https://return.gst.gov.in/returns/auth/gstr3b");
    const context = detectGstPortalContext(url as unknown as Location, "GSTR-3B - Monthly Return");

    expect(context.supported).toBe(true);
    expect(context.pageKind).toBe("gst-filed-returns");
  });

  it("detects the authenticated e-filed returns route as filed returns", () => {
    const url = new URL("https://return.gst.gov.in/returns/auth/efiledReturns");
    const context = detectGstPortalContext(url as unknown as Location, "Goods and Services Tax");

    expect(context.supported).toBe(true);
    expect(context.pageKind).toBe("gst-filed-returns");
  });

  it("stays dormant outside supported GST hosts", () => {
    const url = new URL("https://example.com/returns");
    const context = detectGstPortalContext(url as unknown as Location, "Example");

    expect(context.supported).toBe(false);
    expect(context.origin).toBeUndefined();
    expect(context.requiredAction?.type).toBe("NAVIGATE_TO_SUPPORTED_PAGE");
  });

  it("creates a target for every FY, period, and document type", () => {
    const plan = createGstReturnPlan(
      {
        financialYears: ["FY-2023-24", "FY-2024-25"],
        periods: ["APR", "MAY"],
        documentTypes: ["GSTR-1", "GSTR-3B"],
        formats: ["pdf"],
        sourcePreference: "portal-original-only",
      },
      new Date("2026-06-19T00:00:00.000Z"),
    );

    expect(plan.targets).toHaveLength(8);
    expect(new Set(plan.targets.map((target) => target.targetId)).size).toBe(8);
  });

  it("creates the private filed-returns spike as a GSTR-3B PDF-only plan", () => {
    const plan = createFiledReturnsPrivateSpikePlan(new Date("2026-06-19T00:00:00.000Z"));

    expect(plan.scope).toEqual(FILED_RETURNS_PRIVATE_SPIKE_SCOPE);
    expect(plan.targets).toHaveLength(3);
    expect(plan.targets.every((target) => target.documentType === "GSTR-3B")).toBe(true);
    expect(plan.targets.every((target) => target.requestedFormat === "pdf")).toBe(true);
    expect(plan.targets.every((target) => target.expectedSourceKind === "portal-original")).toBe(
      true,
    );
    expect(plan.disclosuresAccepted).toContain("pack-v0-private-filed-returns-spike");
  });
});

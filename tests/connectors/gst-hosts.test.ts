import { describe, expect, it } from "vitest";
import { isSupportedGstPortalUrl, pickSupportedGstPortalTab } from "../../src/connectors/gst/hosts";

describe("GST portal host guard", () => {
  it("allows only exact GST portal origins used by Pack V0", () => {
    expect(isSupportedGstPortalUrl("https://www.gst.gov.in/")).toBe(true);
    expect(isSupportedGstPortalUrl("https://services.gst.gov.in/services/auth/fowelcome")).toBe(
      true,
    );
    expect(isSupportedGstPortalUrl("https://return.gst.gov.in/returns/auth/gstr3b")).toBe(true);

    expect(isSupportedGstPortalUrl("https://evil-return.gst.gov.in/returns/auth/gstr3b")).toBe(
      false,
    );
    expect(isSupportedGstPortalUrl("https://return.gst.gov.in.evil.example/")).toBe(false);
    expect(isSupportedGstPortalUrl("https://example.com/")).toBe(false);
    expect(isSupportedGstPortalUrl(undefined)).toBe(false);
  });

  it("selects only a tab with an id and exact GST portal origin", () => {
    expect(
      pickSupportedGstPortalTab([
        { id: 10, url: "https://example.com/" },
        { url: "https://return.gst.gov.in/returns/auth/gstr3b" },
        { id: 11, url: "https://return.gst.gov.in/returns/auth/gstr3b" },
      ]),
    ).toEqual({ id: 11, url: "https://return.gst.gov.in/returns/auth/gstr3b" });

    expect(
      pickSupportedGstPortalTab([
        { id: 12, url: "https://return.gst.gov.in.evil.example/" },
        { id: 13, url: undefined },
      ]),
    ).toBeNull();
  });

  it("prefers authenticated returns pages over stale login tabs", () => {
    expect(
      pickSupportedGstPortalTab([
        { id: 10, url: "https://services.gst.gov.in/services/login" },
        { id: 11, url: "https://return.gst.gov.in/returns/auth/efiledReturns" },
      ]),
    ).toEqual({ id: 11, url: "https://return.gst.gov.in/returns/auth/efiledReturns" });

    expect(
      pickSupportedGstPortalTab([
        { id: 12, url: "https://www.gst.gov.in/" },
        { id: 13, url: "https://services.gst.gov.in/services/auth/fowelcome" },
      ]),
    ).toEqual({ id: 13, url: "https://services.gst.gov.in/services/auth/fowelcome" });
  });
});

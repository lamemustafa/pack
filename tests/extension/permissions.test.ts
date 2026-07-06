import { describe, expect, it } from "vitest";
import {
  PACK_EXTENSION_CSP,
  PACK_EXTENSION_ACTION_DEFAULT_ICON,
  PACK_EXTENSION_DESCRIPTION,
  PACK_EXTENSION_HOMEPAGE_URL,
  PACK_EXTENSION_ICONS,
  PACK_EXTENSION_NAME,
  PACK_EXTENSION_PERMISSIONS,
  PACK_EXTENSION_SHORT_NAME,
  PACK_GST_HOST_PERMISSIONS,
} from "../../src/extension/manifest-policy";

describe("extension permission posture", () => {
  it("uses launch-ready public metadata", () => {
    expect(PACK_EXTENSION_NAME).toBe("ComplyEaze Pack: GST Return Downloader");
    expect(PACK_EXTENSION_SHORT_NAME).toBe("ComplyEaze Pack");
    expect(PACK_EXTENSION_DESCRIPTION).toBe(
      "Alpha: locally download GSTR-1/GSTR-3B files; private GSTR-2B source support is pending live proof.",
    );
    expect(PACK_EXTENSION_HOMEPAGE_URL).toBe("https://pack.complyeaze.com/gst");
    expect(PACK_EXTENSION_ICONS).toEqual({
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    });
    expect(PACK_EXTENSION_ACTION_DEFAULT_ICON).toEqual(PACK_EXTENSION_ICONS);
  });

  it("keeps the V0 permission set narrow", () => {
    expect([...PACK_EXTENSION_PERMISSIONS].sort()).toEqual(["downloads", "scripting", "storage"]);
    expect(PACK_EXTENSION_PERMISSIONS).not.toContain("cookies");
    expect(PACK_EXTENSION_PERMISSIONS).not.toContain("tabs");
    expect(PACK_EXTENSION_PERMISSIONS).not.toContain("alarms");
    expect(PACK_EXTENSION_PERMISSIONS).not.toContain("identity");
  });

  it("uses exact GST hosts and no future-portal permissions", () => {
    expect(PACK_GST_HOST_PERMISSIONS).toEqual([
      "https://www.gst.gov.in/*",
      "https://services.gst.gov.in/*",
      "https://return.gst.gov.in/*",
      "https://gstr2b.gst.gov.in/*",
    ]);
    expect(PACK_GST_HOST_PERMISSIONS).not.toContain("<all_urls>");
  });

  it("keeps extension pages on a restrictive local CSP", () => {
    expect(PACK_EXTENSION_CSP).toBe("script-src 'self'; object-src 'self'");
    expect(PACK_EXTENSION_CSP).not.toContain("unsafe-eval");
  });
});

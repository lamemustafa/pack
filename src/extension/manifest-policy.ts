export const PACK_EXTENSION_PERMISSIONS = [
  "downloads",
  "offscreen",
  "scripting",
  "storage",
] as const;

export const PACK_GST_HOST_PERMISSIONS = [
  "https://www.gst.gov.in/*",
  "https://services.gst.gov.in/*",
  "https://return.gst.gov.in/*",
  "https://gstr2b.gst.gov.in/*",
] as const;

export const PACK_EXTENSION_NAME = "ComplyEaze Pack: GST Return Downloader";
export const PACK_EXTENSION_SHORT_NAME = "ComplyEaze Pack";
export const PACK_EXTENSION_DESCRIPTION =
  "Alpha: locally download GSTR-1/GSTR-3B files; private GSTR-2B downloads are source-build experimental.";
export const PACK_EXTENSION_CSP = "script-src 'self'; object-src 'self'";
export const PACK_EXTENSION_HOMEPAGE_URL = "https://pack.complyeaze.com/gst";
export const PACK_EXTENSION_ICONS = {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png",
} as const;

export const PACK_EXTENSION_ACTION_DEFAULT_ICON = PACK_EXTENSION_ICONS;

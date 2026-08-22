export const PACK_EXTENSION_PERMISSIONS = [
  "downloads",
  // Reviewed source-build Blob/OPFS ZIP boundary:
  // https://github.com/lamemustafa/pack/issues/79
  "offscreen",
  "scripting",
  // Reviewed: the panel is the extension's surface, and a side panel is the only
  // one that can stay visible while the portal tab holds focus. A popup dies on
  // outside focus, and `getRequiredGstTab` deliberately focuses the GST tab and
  // its window at the start of a run, so any surface occupying a tab is pushed
  // behind the page the run is driving.
  "sidePanel",
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
  "Beta: locally download your filed GSTR-1 and GSTR-3B returns and your GSTR-2B statements.";
export const PACK_EXTENSION_CSP = "script-src 'self'; object-src 'self'";
export const PACK_EXTENSION_HOMEPAGE_URL = "https://pack.complyeaze.com/gst";
export const PACK_EXTENSION_ICONS = {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png",
} as const;

export const PACK_EXTENSION_ACTION_DEFAULT_ICON = PACK_EXTENSION_ICONS;

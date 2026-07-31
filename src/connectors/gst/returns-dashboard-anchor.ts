export type ReturnsDashboardAnchorNavigation = "clicked" | "not-found" | "ambiguous";

const RETURNS_ORIGIN = "https://return.gst.gov.in";
const RETURNS_DASHBOARD_PATHNAME = "/returns/auth/dashboard";

/** Clicks the one portal-owned Returns Dashboard link without constructing a URL. */
export function clickReturnsDashboardAnchor(
  documentRef: Document,
): ReturnsDashboardAnchorNavigation {
  const matches = Array.from(documentRef.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(
    (anchor) => {
      try {
        const href = new URL(anchor.href, documentRef.defaultView?.location.href);
        return href.origin === RETURNS_ORIGIN && href.pathname === RETURNS_DASHBOARD_PATHNAME;
      } catch {
        return false;
      }
    },
  );
  if (matches.length === 0) return "not-found";
  if (matches.length !== 1) return "ambiguous";
  matches[0]?.click();
  return "clicked";
}

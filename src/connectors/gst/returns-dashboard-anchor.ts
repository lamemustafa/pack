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
  const visibleMatches = matches.filter(isVisibleAndActionable);
  if (visibleMatches.length === 0) return "not-found";
  if (visibleMatches.length !== 1) return "ambiguous";
  visibleMatches[0]?.click();
  return "clicked";
}

function isVisibleAndActionable(element: HTMLElement): boolean {
  if (element.hidden || element.closest("[inert]")) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  if (
    style.display === "none" ||
    style.visibility !== "visible" ||
    style.opacity === "0" ||
    style.pointerEvents === "none"
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

import { isActionableGstPortalTabUrl } from "./hosts";
import { isActionablePortalControl, isSemanticallyEnabledPortalControl } from "./filed-returns-dom";

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
  if (visibleMatches.length === 0) {
    const uniqueMatch = matches[0];
    const location = documentRef.defaultView?.location;
    // Captured 2026-08-24: the GSTR-2B summary page carries exactly one Returns
    // Dashboard anchor, semantically enabled, collapsed inside two `display:none`
    // nav lists. Restricting this fallback to the services auth landing left a
    // GSTR-3B run unable to leave that page at all. The conditions that carry the
    // safety are unchanged -- one match on the whole page, and the control is not
    // disabled, inert, aria-hidden, transparent or pointer-events:none -- and the
    // caller still verifies the origin actually changed before continuing.
    if (
      matches.length === 1 &&
      uniqueMatch &&
      isActionableGstPortalTabUrl(location?.href) &&
      isSemanticallyEnabledPortalControl(uniqueMatch)
    ) {
      uniqueMatch.click();
      return "clicked";
    }
    return "not-found";
  }
  if (visibleMatches.length !== 1) return "ambiguous";
  visibleMatches[0]?.click();
  return "clicked";
}

function isVisibleAndActionable(element: HTMLElement): boolean {
  if (!isActionablePortalControl(element)) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  if (style.visibility !== "visible") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

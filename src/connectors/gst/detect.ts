import type { PortalContext } from "../../core/contracts";
import { GST_SERVICES_ORIGIN, SUPPORTED_GST_ORIGINS } from "./constants";

const RETURN_PATH_HINTS = [/\/returns\//i, /\/return\//i, /\/gst-ret/i, /\/services\/returns/i];
const GST_AUTH_LANDING_PATH_HINTS = [/\/services\/auth\/fowelcome$/i];
const GST_ACCESS_DENIED_PATH_HINTS = [/\/services\/error\/accessdenied\/?$/i];
const GST_AUTHENTICATED_DASHBOARD_PATH_HINTS = [/\/services\/auth\/dashboard\/?$/i];
const GST_RETURNS_HUB_PATH_HINTS = [/\/services\/auth\/quicklinks\/returns\/?$/i];
const AUTHENTICATED_WELCOME_MARKERS = [
  /last logged in/i,
  /returns calendar/i,
  /welcome .* to gst common portal/i,
];
const FILED_RETURNS_PATH_HINTS = [
  /\/pages\/returns\/efiledreturns\.html$/i,
  /\/returns\/auth\/efiledreturns$/i,
  /\/returns\/auth\/gstr3b$/i,
  /\/gstr2b\/auth\/gstr2b\/summary\/?$/i,
  /view[-_/]?filed[-_/]?returns/i,
  /filed[-_/]?returns/i,
  /returns\/auth\/filed/i,
];
const FILED_RETURNS_TITLE_HINTS = [/view filed returns/i, /filed returns/i, /\bgstr2b\b/i];

export function detectGstPortalContext(
  locationLike: Location,
  title: string,
  visibleText = "",
): PortalContext {
  const origin = locationLike.origin;
  if (!SUPPORTED_GST_ORIGINS.has(origin)) {
    return {
      connectorId: "gst",
      supported: false,
      pageKind: "unsupported",
      requiredAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Open a supported GST Portal return page to use Pack.",
        canResume: true,
      },
    };
  }

  const isReturnPage = RETURN_PATH_HINTS.some((pattern) => pattern.test(locationLike.pathname));
  const isAuthLandingRoute = isGstAuthLandingRoute(locationLike);
  const isAuthLandingPage =
    isAuthLandingRoute &&
    !AUTHENTICATED_WELCOME_MARKERS.some((pattern) => pattern.test(visibleText));
  const isAccessDeniedPage = GST_ACCESS_DENIED_PATH_HINTS.some((pattern) =>
    pattern.test(locationLike.pathname),
  );
  const isAuthenticatedWelcomePage = isAuthLandingRoute && !isAuthLandingPage;
  const isReturnsHubPage = GST_RETURNS_HUB_PATH_HINTS.some((pattern) =>
    pattern.test(locationLike.pathname),
  );
  const isAuthenticatedServicesDashboard = GST_AUTHENTICATED_DASHBOARD_PATH_HINTS.some((pattern) =>
    pattern.test(locationLike.pathname),
  );
  const isFiledReturnsPage =
    FILED_RETURNS_PATH_HINTS.some((pattern) => pattern.test(locationLike.pathname)) ||
    FILED_RETURNS_TITLE_HINTS.some((pattern) => pattern.test(title));

  // The path is the authoritative failure signal. A single-page transition can
  // leave a filed-returns title behind while the portal renders this error page.
  if (isAccessDeniedPage) {
    return {
      connectorId: "gst",
      supported: false,
      origin,
      pageKind: "gst-access-denied",
    };
  }

  if (isFiledReturnsPage) {
    return {
      connectorId: "gst",
      supported: true,
      origin,
      pageKind: "gst-filed-returns",
    };
  }

  if (isAuthLandingPage) {
    return {
      connectorId: "gst",
      supported: true,
      origin,
      pageKind: "gst-auth-landing",
    };
  }

  if (isReturnPage || isAuthenticatedWelcomePage) {
    return {
      connectorId: "gst",
      supported: true,
      origin,
      pageKind: "supported-gst-return-page",
    };
  }

  if (isReturnsHubPage || isAuthenticatedServicesDashboard) {
    return {
      connectorId: "gst",
      supported: true,
      origin,
      pageKind: "gst-portal",
    };
  }

  return {
    connectorId: "gst",
    supported: false,
    origin,
    pageKind: "gst-portal",
    requiredAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: "Navigate to the GST return documents area, then reopen Pack.",
      canResume: true,
    },
  };
}

/** Matches only the portal's canonical post-login landing route. */
export function isGstAuthLandingRoute(
  locationLike: Pick<Location, "origin" | "pathname">,
): boolean {
  return (
    locationLike.origin === GST_SERVICES_ORIGIN &&
    GST_AUTH_LANDING_PATH_HINTS.some((pattern) => pattern.test(locationLike.pathname))
  );
}

import type { PortalContext } from "../../core/contracts";
import { redactSensitiveText } from "../../core/redaction";
import { SUPPORTED_GST_ORIGINS } from "./constants";

const RETURN_PATH_HINTS = [/\/returns\//i, /\/return\//i, /\/gst-ret/i, /\/services\/returns/i];
const GST_AUTH_LANDING_PATH_HINTS = [/\/services\/auth\/fowelcome$/i];
const FILED_RETURNS_PATH_HINTS = [
  /\/pages\/returns\/efiledreturns\.html$/i,
  /\/returns\/auth\/efiledreturns$/i,
  /\/returns\/auth\/gstr3b$/i,
  /view[-_/]?filed[-_/]?returns/i,
  /filed[-_/]?returns/i,
  /returns\/auth\/filed/i,
];
const FILED_RETURNS_TITLE_HINTS = [/view filed returns/i, /filed returns/i];

export function detectGstPortalContext(locationLike: Location, title: string): PortalContext {
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

  const safeTitle = redactSensitiveText(title).slice(0, 80);
  const isReturnPage = RETURN_PATH_HINTS.some((pattern) => pattern.test(locationLike.pathname));
  const isAuthLandingPage = GST_AUTH_LANDING_PATH_HINTS.some((pattern) =>
    pattern.test(locationLike.pathname),
  );
  const isFiledReturnsPage =
    FILED_RETURNS_PATH_HINTS.some((pattern) => pattern.test(locationLike.pathname)) ||
    FILED_RETURNS_TITLE_HINTS.some((pattern) => pattern.test(safeTitle));

  if (isFiledReturnsPage) {
    return {
      connectorId: "gst",
      supported: true,
      origin,
      pageKind: "gst-filed-returns",
      safeTitle,
    };
  }

  if (isAuthLandingPage) {
    return {
      connectorId: "gst",
      supported: true,
      origin,
      pageKind: "gst-auth-landing",
      safeTitle,
    };
  }

  if (isReturnPage) {
    return {
      connectorId: "gst",
      supported: true,
      origin,
      pageKind: "supported-gst-return-page",
      safeTitle,
    };
  }

  return {
    connectorId: "gst",
    supported: false,
    origin,
    pageKind: "gst-portal",
    safeTitle,
    requiredAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: "Navigate to the GST return documents area, then reopen Pack.",
      canResume: true,
    },
  };
}

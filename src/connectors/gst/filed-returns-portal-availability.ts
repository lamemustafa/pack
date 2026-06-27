import type { PortalDownloadTriggerResult, PortalFlowStepResult } from "../../core/contracts";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const BLOCKED_PORTAL_PATTERNS = [
  /request rejected/i,
  /access denied/i,
  /you are not authorized/i,
  /session (?:is |has )?expired/i,
  /please login again/i,
  /invalid session/i,
];
const SCHEDULED_DOWNTIME_PATTERNS = [
  /scheduled downtime/i,
  /downtime window/i,
  /services will not be available/i,
  /enhancing the services/i,
  /under maintenance/i,
  /temporarily unavailable/i,
  /kindly come back later/i,
];

type PortalAvailabilityIssue = Pick<
  PortalFlowStepResult,
  "connectorId" | "scopeId" | "state" | "safeSignals" | "safeMessage" | "userAction"
>;

export function detectFiledReturnsPortalAvailabilityIssue(
  documentRef: Document,
): PortalAvailabilityIssue | null {
  const windowRef = documentRef.defaultView;
  const path = windowRef?.location.pathname ?? "";
  const bodyText = documentRef.body?.innerText ?? documentRef.body?.textContent ?? "";

  if (isScheduledDowntimeOutagePage(documentRef, bodyText)) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "blocked",
      safeSignals: ["portal-scheduled-downtime"],
      safeMessage:
        "The GST portal is in scheduled downtime. Wait until GST services are available, then reopen Pack and retry.",
      userAction: {
        type: "WAIT_FOR_PORTAL_AVAILABILITY",
        message: "Wait until the GST scheduled downtime window is over, then reopen Pack.",
        canResume: true,
      },
    };
  }

  const isBlockedPath = /\/services\/error|\/error\//i.test(path);
  const isBlockedText = matchesAny(bodyText, BLOCKED_PORTAL_PATTERNS);
  if (!isBlockedPath && !isBlockedText) return null;

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: /session|login/i.test(bodyText) ? "login-required" : "blocked",
    safeSignals: ["portal-blocked-or-session-expired"],
    safeMessage:
      "The GST portal appears to be on an access-denied or expired-session screen. Please return to an authenticated GST page before using Pack.",
    userAction: {
      type: "LOGIN",
      message: "Sign in to the GST portal, then reopen Pack on the authenticated page.",
      canResume: true,
    },
  };
}

export function asPortalDownloadTriggerResult(
  issue: PortalAvailabilityIssue,
): PortalDownloadTriggerResult {
  return {
    connectorId: issue.connectorId,
    scopeId: issue.scopeId,
    state: issue.state === "login-required" ? "login-required" : "blocked",
    safeSignals: issue.safeSignals,
    safeMessage: issue.safeMessage,
    ...(issue.userAction ? { userAction: issue.userAction } : {}),
  };
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isScheduledDowntimeOutagePage(documentRef: Document, bodyText: string): boolean {
  if (!matchesAny(bodyText, SCHEDULED_DOWNTIME_PATTERNS)) return false;

  const headingText = Array.from(documentRef.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    .map((heading) => heading.textContent ?? "")
    .join(" ");
  const headingSignalsOutage = /scheduled downtime|maintenance|temporarily unavailable/i.test(
    headingText,
  );
  const bodySignalsOutageWindow =
    /downtime window|kindly come back later|services will not be available/i.test(bodyText);
  const hasInteractivePortalSurface = Boolean(
    documentRef.querySelector("form,select,input,button,[role='button'],nav,header,a[href]"),
  );

  return (headingSignalsOutage || bodySignalsOutageWindow) && !hasInteractivePortalSurface;
}

import type { FiledReturnsFlowSummary, PortalContext } from "../../core/contracts";

export type PopupPresentationKind =
  | "loading"
  | "unsupported"
  | "session-expired"
  | "ready"
  | "downloading"
  | "partial"
  | "complete"
  | "unavailable"
  | "blocked"
  | "error";

export interface PopupPresentationState {
  badge: string;
  body: string;
  icon: string;
  kind: PopupPresentationKind;
  title: string;
  tone: "neutral" | "ready" | "warning" | "success" | "danger";
}

export function getPopupPresentationState(
  context: PortalContext | null,
  summary: FiledReturnsFlowSummary | null,
  busy: string | null,
): PopupPresentationState {
  if (busy === "start-filed-returns-flow" || summary?.status === "running") {
    return {
      badge: "Downloading",
      body: "Pack is collecting the selected files. Keep the GST Portal tab open.",
      icon: "↓",
      kind: "downloading",
      title: "Packing your files",
      tone: "ready",
    };
  }

  // A stale run summary must not mask the active tab's portal state.
  if (context && !context.supported) {
    return getUnsupportedContextState(context);
  }

  if (summary?.status === "complete") {
    const unavailable = summary.flowStep.safeSignals.some((signal) =>
      signal.includes("artifact-unavailable"),
    );
    if (unavailable) {
      return {
        badge: "Partly available",
        body: summary.flowStep.safeMessage,
        icon: "!",
        kind: "unavailable",
        title: "Download saved with one unavailable file",
        tone: "warning",
      };
    }
    return {
      badge: "Complete",
      body: "The selected files were saved by your browser.",
      icon: "✓",
      kind: "complete",
      title: "Your download is ready",
      tone: "success",
    };
  }

  if (summary?.status === "partial") {
    return {
      badge: "Partly complete",
      body: "Some selected files were saved. Check the affected period before continuing.",
      icon: "!",
      kind: "partial",
      title: "Download partly complete",
      tone: "warning",
    };
  }

  if (isSessionExpired(context, summary)) {
    return {
      badge: "Sign-in needed",
      body: "Sign in directly on the GST Portal. Pack never handles your login details or OTP.",
      icon: "!",
      kind: "session-expired",
      title: "Sign in on GST Portal",
      tone: "warning",
    };
  }

  if (summary?.status === "blocked" || summary?.status === "cancelled") {
    if (summary.flowStep.safeSignals.includes("filed-return-positively-not-filed")) {
      return {
        badge: "Unavailable",
        body: "The GST Portal reports that this return was not filed for the selected period.",
        icon: "–",
        kind: "unavailable",
        title: "No filed return for this period",
        tone: "neutral",
      };
    }
    if (summary.currentPeriod) {
      return {
        badge: "Needs review",
        body: `Pack stopped at ${summary.currentPeriod}. Retry the download after checking that period on GST Portal.`,
        icon: "!",
        kind: "blocked",
        title: `${summary.currentPeriod} needs attention`,
        tone: "warning",
      };
    }
    return {
      badge: "Needs review",
      body: "Pack could not finish this download. Retry after checking the GST Portal page.",
      icon: "!",
      kind: "error",
      title: "Download could not finish",
      tone: "danger",
    };
  }

  if (!context) {
    return {
      badge: "Checking",
      body: "Checking for a supported GST Portal page in this browser.",
      icon: "…",
      kind: "loading",
      title: "Checking this tab",
      tone: "neutral",
    };
  }

  if (context.pageKind === "gst-auth-landing" || context.pageKind === "unsupported") {
    return getUnsupportedContextState(context);
  }

  return {
    badge: "Portal detected",
    body: "Choose the return and period to download.",
    icon: "✓",
    kind: "ready",
    title: "GST Portal page detected",
    tone: "ready",
  };
}

function getUnsupportedContextState(context: PortalContext): PopupPresentationState {
  const authRequired = context.pageKind === "gst-auth-landing";
  return {
    badge: authRequired ? "Sign-in needed" : "Unsupported tab",
    body: authRequired
      ? "Sign in directly on the GST Portal, then open Pack again."
      : "Open GST Portal and navigate to filed returns to use Pack.",
    icon: authRequired ? "!" : "⌂",
    kind: authRequired ? "session-expired" : "unsupported",
    title: authRequired ? "Sign in on GST Portal" : "Ready when you are",
    tone: authRequired ? "warning" : "neutral",
  };
}

function isSessionExpired(context: PortalContext | null, summary: FiledReturnsFlowSummary | null) {
  return (
    context?.requiredAction?.type === "LOGIN" ||
    summary?.flowStep.state === "login-required" ||
    summary?.flowStep.safeSignals.includes("gst-login-tab-opened")
  );
}

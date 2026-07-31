import { browser } from "wxt/browser";
import type { PortalContext, UserActionRequired } from "../core/contracts";
import { SUPPORTED_GST_ORIGINS } from "../connectors/gst/constants";

const CONTEXT_KEYS = [
  "connectorId",
  "origin",
  "pageKind",
  "requiredAction",
  "safeTitle",
  "supported",
] as const;
const PAGE_KINDS = new Set<PortalContext["pageKind"]>([
  "gst-auth-landing",
  "gst-filed-returns",
  "gst-portal",
  "supported-gst-return-page",
  "unknown",
  "unsupported",
]);
const SUPPORTED_PAGE_KINDS = new Set<PortalContext["pageKind"]>([
  "gst-auth-landing",
  "gst-filed-returns",
  "supported-gst-return-page",
]);
const UNSUPPORTED_PAGE_KINDS = new Set<PortalContext["pageKind"]>(["unknown", "unsupported"]);

const CANONICAL_ACTIONS: Record<UserActionRequired["type"], UserActionRequired> = {
  ALLOW_MULTIPLE_DOWNLOADS: {
    type: "ALLOW_MULTIPLE_DOWNLOADS",
    message: "Allow browser downloads for the GST Portal, then retry.",
    canResume: true,
  },
  COMPLETE_CAPTCHA: {
    type: "COMPLETE_CAPTCHA",
    message: "Complete the GST Portal CAPTCHA, then retry.",
    canResume: true,
  },
  COMPLETE_OTP: {
    type: "COMPLETE_OTP",
    message: "Complete the GST Portal OTP step, then retry.",
    canResume: true,
  },
  LOGIN: {
    type: "LOGIN",
    message: "Sign in to the GST Portal, then retry.",
    canResume: true,
  },
  NAVIGATE_TO_SUPPORTED_PAGE: {
    type: "NAVIGATE_TO_SUPPORTED_PAGE",
    message: "Open a supported GST Portal return page, then retry.",
    canResume: true,
  },
  RETRY_PORTAL_GENERATION: {
    type: "RETRY_PORTAL_GENERATION",
    message: "Retry the GST Portal action from the same page.",
    canResume: true,
  },
  WAIT_FOR_PORTAL_AVAILABILITY: {
    type: "WAIT_FOR_PORTAL_AVAILABILITY",
    message: "Wait for the GST Portal to become available, then retry.",
    canResume: true,
  },
};

export function parseCanonicalGstPortalContext(
  input: unknown,
  tabUrl: string | undefined,
): PortalContext | null {
  const origin = supportedGstOriginFromTabUrl(tabUrl);
  if (!origin || !input || typeof input !== "object") return null;
  const context = input as Partial<PortalContext> & Record<string, unknown>;
  if (!hasOnlyKeys(context, CONTEXT_KEYS) || context.connectorId !== "gst") return null;
  if (context.origin !== undefined && context.origin !== origin) return null;
  if (typeof context.supported !== "boolean") return null;
  if (typeof context.pageKind !== "string" || !PAGE_KINDS.has(context.pageKind)) return null;
  if (SUPPORTED_PAGE_KINDS.has(context.pageKind) && !context.supported) return null;
  if (UNSUPPORTED_PAGE_KINDS.has(context.pageKind) && context.supported) return null;
  if (
    context.safeTitle !== undefined &&
    (typeof context.safeTitle !== "string" || context.safeTitle.length > 160)
  ) {
    return null;
  }
  const requiredAction = parseCanonicalContextAction(context.requiredAction);
  if (context.requiredAction !== undefined && !requiredAction) return null;

  return {
    connectorId: "gst",
    supported: context.supported,
    origin,
    pageKind: context.pageKind,
    ...(requiredAction ? { requiredAction } : {}),
  };
}

export async function persistCanonicalGstPortalContext(
  key: string,
  input: unknown,
  tabUrl: string | undefined,
): Promise<PortalContext | null> {
  const context = parseCanonicalGstPortalContext(input, tabUrl);
  if (!context) {
    await browser.storage.session.remove(key);
    return null;
  }
  await browser.storage.session.set({ [key]: context });
  return context;
}

function parseCanonicalContextAction(input: unknown): UserActionRequired | null {
  if (input === undefined) return null;
  if (!input || typeof input !== "object") return null;
  const action = input as Partial<UserActionRequired> & Record<string, unknown>;
  if (!hasOnlyKeys(action, ["canResume", "message", "type"])) return null;
  if (
    typeof action.canResume !== "boolean" ||
    typeof action.message !== "string" ||
    action.message.length < 1 ||
    action.message.length > 240 ||
    typeof action.type !== "string" ||
    !Object.hasOwn(CANONICAL_ACTIONS, action.type)
  ) {
    return null;
  }
  return { ...CANONICAL_ACTIONS[action.type as UserActionRequired["type"]] };
}

function supportedGstOriginFromTabUrl(tabUrl: string | undefined): string | null {
  if (!tabUrl) return null;
  try {
    const origin = new URL(tabUrl).origin;
    return SUPPORTED_GST_ORIGINS.has(origin) ? origin : null;
  } catch {
    return null;
  }
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

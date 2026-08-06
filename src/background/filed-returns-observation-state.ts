import { browser } from "wxt/browser";
import type { PortalObservation, UserActionRequired } from "../core/contracts";
import {
  detectVisibleReturnLabel,
  scopeIdForVisibleReturnLabel,
} from "../connectors/gst/filed-returns-observer-scope";
import { FILED_RETURNS_OBSERVATION_SIGNALS } from "../connectors/gst/filed-returns-observer-signals";
import type {
  FiledReturnsObservation,
  FiledReturnsObservationState,
} from "../connectors/gst/filed-returns-observer-types";

const OBSERVATION_KEYS = [
  "connectorId",
  "pageKind",
  "safeMessage",
  "safeSignals",
  "scopeId",
  "state",
  "userAction",
] as const;

const OBSERVATION_STATES = new Set<FiledReturnsObservationState>([
  "detail-summary-modal-open",
  "download-not-visible",
  "filed-return-results-visible",
  "filters-required",
  "gstr-3b-not-visible",
  "login-required",
  "page-settling",
  "ready",
  "wrong-page",
]);

const OBSERVATION_SCOPE_IDS = new Set<FiledReturnsObservation["scopeId"]>([
  "gst-filed-returns-gstr3b-pdf-private-v0",
  "gst-filed-returns-gstr1-pdf-private-v0",
  "gst-gstr2b-private-v0",
]);

const OBSERVATION_SIGNALS = new Set<string>(FILED_RETURNS_OBSERVATION_SIGNALS);

const USER_ACTION_TYPES = new Set<UserActionRequired["type"]>([
  "ALLOW_MULTIPLE_DOWNLOADS",
  "COMPLETE_CAPTCHA",
  "COMPLETE_OTP",
  "LOGIN",
  "NAVIGATE_TO_SUPPORTED_PAGE",
  "RETRY_PORTAL_GENERATION",
  "WAIT_FOR_PORTAL_AVAILABILITY",
]);

export function parseCanonicalFiledReturnsObservation(input: unknown): PortalObservation | null {
  if (!input || typeof input !== "object") return null;
  const observation = input as Partial<PortalObservation> & Record<string, unknown>;
  if (!hasOnlyKeys(observation, OBSERVATION_KEYS)) return null;
  if (observation.connectorId !== "gst" || observation.pageKind !== "gst-filed-returns")
    return null;
  if (
    typeof observation.scopeId !== "string" ||
    !OBSERVATION_SCOPE_IDS.has(observation.scopeId as FiledReturnsObservation["scopeId"])
  ) {
    return null;
  }
  if (
    typeof observation.state !== "string" ||
    !OBSERVATION_STATES.has(observation.state as FiledReturnsObservationState)
  ) {
    return null;
  }
  if (
    typeof observation.safeMessage !== "string" ||
    observation.safeMessage.length < 1 ||
    observation.safeMessage.length > 400
  ) {
    return null;
  }
  const safeSignals = parseObservationSignals(observation.safeSignals);
  if (!safeSignals || !isConsistentObservation(observation, safeSignals)) return null;
  if (
    observation.userAction !== undefined &&
    !isStructurallyValidUserAction(observation.userAction)
  ) {
    return null;
  }

  const state = observation.state as FiledReturnsObservationState;
  const scopeId = observation.scopeId as FiledReturnsObservation["scopeId"];
  const userAction = canonicalUserAction(state);
  return {
    connectorId: "gst",
    pageKind: "gst-filed-returns",
    scopeId,
    state,
    safeSignals,
    safeMessage: canonicalObservationMessage(state, scopeId),
    ...(userAction ? { userAction } : {}),
  };
}

export async function persistCanonicalFiledReturnsObservation(
  key: string,
  input: unknown,
): Promise<PortalObservation | null> {
  const observation = parseCanonicalFiledReturnsObservation(input);
  if (!observation) {
    await browser.storage.session.remove(key);
    return null;
  }
  await browser.storage.session.set({ [key]: observation });
  return observation;
}

export async function readCanonicalFiledReturnsObservation(
  key: string,
): Promise<PortalObservation | null> {
  const values = await browser.storage.session.get(key);
  const input = values[key];
  if (input === undefined) return null;
  return persistCanonicalFiledReturnsObservation(key, input);
}

function parseObservationSignals(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > 32) return null;
  if (
    !input.every(
      (signal): signal is string => typeof signal === "string" && OBSERVATION_SIGNALS.has(signal),
    )
  ) {
    return null;
  }
  return Array.from(new Set(input));
}

function isConsistentObservation(
  observation: Partial<PortalObservation>,
  safeSignals: readonly string[],
): boolean {
  const state = observation.state as FiledReturnsObservationState;
  const scopeId = observation.scopeId as FiledReturnsObservation["scopeId"];
  if (state === "login-required")
    return scopeId === gstr3bScopeId() && sameSignals(safeSignals, ["login"]);
  if (state === "wrong-page") {
    return scopeId === gstr3bScopeId() && !safeSignals.includes("filed-returns-heading");
  }
  if (state === "detail-summary-modal-open") {
    return scopeId === gstr3bScopeId() && safeSignals.includes("detail-summary-modal");
  }
  if (state === "filed-return-results-visible") {
    return (
      scopeId === gstr3bScopeId() &&
      safeSignals.includes("view-download-column") &&
      safeSignals.includes("view-action")
    );
  }
  if (state === "filters-required") {
    return scopeId === gstr3bScopeId() && safeSignals.includes("filter-form");
  }
  if (state === "page-settling") {
    return scopeId === gstr3bScopeId() && safeSignals.includes("filed-returns-route");
  }
  if (state === "gstr-3b-not-visible") {
    return (
      scopeId === gstr3bScopeId() &&
      !safeSignals.some((signal) => ["gstr-1", "gstr-2b", "gstr-3b"].includes(signal))
    );
  }
  if (state === "ready") return scopeId === readyScopeId(safeSignals);
  return scopeId === scopeIdForVisibleReturnLabel(detectVisibleReturnLabel(safeSignals));
}

function readyScopeId(safeSignals: readonly string[]): FiledReturnsObservation["scopeId"] | null {
  if (safeSignals.includes("download-filed-gstr-3b")) return gstr3bScopeId();
  if (
    safeSignals.includes("download-gstr2b-summary-pdf") ||
    safeSignals.includes("download-gstr2b-details-excel")
  ) {
    return "gst-gstr2b-private-v0";
  }
  if (
    safeSignals.includes("download-filed-gstr-1") ||
    safeSignals.includes("download-pdf-gstr-1") ||
    safeSignals.includes("download-excel-gstr-1")
  ) {
    return "gst-filed-returns-gstr1-pdf-private-v0";
  }
  return null;
}

function canonicalObservationMessage(
  state: FiledReturnsObservationState,
  scopeId: FiledReturnsObservation["scopeId"],
): string {
  const messages: Record<
    Exclude<FiledReturnsObservationState, "ready" | "download-not-visible">,
    string
  > = {
    "detail-summary-modal-open":
      "The filed GSTR-3B detail page is open, but an informational summary modal is blocking the final download controls. Close the modal and run the check again.",
    "filed-return-results-visible":
      "Filed return results are visible. Open a row with View to expose the portal's final PDF/download controls.",
    "filters-required":
      "The filed returns filter form is visible. Pack will follow the portal's visible filter instructions before searching.",
    "gstr-3b-not-visible":
      "The filed returns page is visible, but the requested return type is not visible yet.",
    "login-required": "Sign in to the GST Portal, then reopen Pack.",
    "page-settling":
      "The filed returns page route is open and Pack is waiting for the form to load.",
    "wrong-page": "Navigate to Services > Returns > View Filed Returns.",
  };
  if (state === "ready") {
    if (scopeId === "gst-gstr2b-private-v0") return "GSTR-2B download controls appear ready.";
    if (scopeId === "gst-filed-returns-gstr1-pdf-private-v0") {
      return "Filed GSTR-1 download controls appear ready.";
    }
    return "Filed GSTR-3B PDF controls appear ready for the private spike.";
  }
  if (state === "download-not-visible") {
    const label =
      scopeId === "gst-gstr2b-private-v0"
        ? "GSTR-2B"
        : scopeId === "gst-filed-returns-gstr1-pdf-private-v0"
          ? "GSTR-1"
          : "GSTR-3B";
    return `${label} is visible, but a filed-return download control is not visible.`;
  }
  return messages[state];
}

function canonicalUserAction(state: FiledReturnsObservationState): UserActionRequired | null {
  if (state === "login-required") {
    return {
      type: "LOGIN",
      message: "Sign in to the GST Portal in this browser tab, then reopen Pack.",
      canResume: true,
    };
  }
  if (state === "wrong-page") {
    return {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: "Navigate to Services > Returns > View Filed Returns.",
      canResume: true,
    };
  }
  return null;
}

function isStructurallyValidUserAction(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const action = input as Partial<UserActionRequired> & Record<string, unknown>;
  return (
    hasOnlyKeys(action, ["canResume", "message", "type"]) &&
    typeof action.canResume === "boolean" &&
    typeof action.message === "string" &&
    action.message.length >= 1 &&
    action.message.length <= 240 &&
    typeof action.type === "string" &&
    USER_ACTION_TYPES.has(action.type as UserActionRequired["type"])
  );
}

function sameSignals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((signal, index) => signal === right[index]);
}

function gstr3bScopeId(): FiledReturnsObservation["scopeId"] {
  return "gst-filed-returns-gstr3b-pdf-private-v0";
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

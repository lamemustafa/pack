import type {
  FiledReturnsDownloadScope,
  FiledReturnsTargetBoundViewPoint,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { sendMessageToTabWithInjection } from "./gst-tab-context";

const DEBUGGER_PROTOCOL_VERSION = "1.3";

export interface Gstr1DebuggerViewDeps {
  attach: (tabId: number) => Promise<void>;
  detach: (tabId: number) => Promise<void>;
  dispatchMouseEvent: (
    tabId: number,
    type: "mouseMoved" | "mousePressed" | "mouseReleased",
    point: FiledReturnsTargetBoundViewPoint,
  ) => Promise<void>;
  hasPermission: () => Promise<boolean>;
  resolveViewPoint: (
    tabId: number,
    scope: FiledReturnsDownloadScope,
  ) => Promise<PackMessageResponse>;
}

export async function clickGstr1ResultViewWithDebugger(
  tabId: number,
  scope: FiledReturnsDownloadScope,
  deps: Gstr1DebuggerViewDeps = chromeDebuggerViewDeps,
): Promise<PortalFlowStepResult> {
  let hasPermission = false;
  try {
    hasPermission = await deps.hasPermission();
  } catch {
    // A missing or unavailable debugger API must preserve the manual recovery path.
  }
  if (scope.returnType !== "GSTR-1" || !hasPermission) {
    return debuggerUnavailableStep(scope, "filed-gstr1-debugger-permission-required");
  }

  let preflightResponse: PackMessageResponse;
  try {
    preflightResponse = await deps.resolveViewPoint(tabId, scope);
  } catch {
    return debuggerUnavailableStep(scope, "filed-gstr1-debugger-view-point-unavailable");
  }
  if (!preflightResponse.ok || !("gstr1ViewPoint" in preflightResponse)) {
    if (preflightResponse.ok && "flowStep" in preflightResponse) return preflightResponse.flowStep;
    return debuggerUnavailableStep(scope, "filed-gstr1-debugger-view-point-unavailable");
  }

  let attached = false;
  try {
    await deps.attach(tabId);
    attached = true;

    // Attaching can alter the viewport. Resolve again so input is bound to the visible control
    // after any debugger UI has settled, and fail closed if the target changed meanwhile.
    const attachedResponse = await deps.resolveViewPoint(tabId, scope);
    if (!attachedResponse.ok || !("gstr1ViewPoint" in attachedResponse)) {
      if (attachedResponse.ok && "flowStep" in attachedResponse) return attachedResponse.flowStep;
      return debuggerUnavailableStep(scope, "filed-gstr1-debugger-view-point-unavailable");
    }

    await deps.dispatchMouseEvent(tabId, "mouseMoved", attachedResponse.gstr1ViewPoint);
    await deps.dispatchMouseEvent(tabId, "mousePressed", attachedResponse.gstr1ViewPoint);
    await deps.dispatchMouseEvent(tabId, "mouseReleased", attachedResponse.gstr1ViewPoint);
    return {
      connectorId: "gst",
      scopeId: filedReturnScopeId("GSTR-1"),
      state: "clicked",
      safeSignals: [
        "filed-return-result-view-clicked",
        "result-row-gstr1",
        "filed-gstr1-result-view-debugger-clicked",
      ],
      safeMessage:
        "Pack used the browser's approved input control to click the exact filed GSTR-1 View action and immediately detached.",
    };
  } catch {
    return debuggerUnavailableStep(scope, "filed-gstr1-debugger-input-unavailable");
  } finally {
    if (attached) await deps.detach(tabId).catch(() => undefined);
  }
}

function debuggerUnavailableStep(
  scope: FiledReturnsDownloadScope,
  safeSignal: string,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId("GSTR-1"),
    state: "user-action-required",
    safeSignals: ["filed-gstr1-result-view-user-action-required", safeSignal],
    safeMessage: `Pack verified the filed GSTR-1 result for ${scope.period}, but automatic View control is unavailable. Click that row's exact View control, then reopen Pack and retry this period.`,
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: `Click View on the filed GSTR-1 result for ${scope.period}, then reopen Pack and retry this period.`,
      canResume: true,
    },
  };
}

const chromeDebuggerViewDeps: Gstr1DebuggerViewDeps = {
  hasPermission: () => chrome.permissions.contains({ permissions: ["debugger"] }),
  attach: (tabId) => chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION),
  detach: (tabId) => chrome.debugger.detach({ tabId }),
  resolveViewPoint: (tabId, scope) =>
    sendMessageToTabWithInjection(tabId, {
      type: "PACK_CONTENT_RESOLVE_GSTR1_VIEW_POINT_V3",
      payload: scope,
    }),
  dispatchMouseEvent: async (tabId, type, point) => {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      button: type === "mouseMoved" ? "none" : "left",
      buttons: type === "mousePressed" ? 1 : 0,
      clickCount: type === "mouseMoved" ? 0 : 1,
    });
  },
};

import React from "react";
import { browser } from "wxt/browser";
import type { PortalContext, PortalObservation } from "../../core/contracts";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import type {
  FullFiscalYearTargetRecoveryPayload,
  PackMessage,
  PackMessageResponse,
} from "../../connectors/gst/messages";
import {
  DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE,
  normaliseFiledReturnsScope,
} from "../../connectors/gst/filed-returns-scope";
import { PACK_SESSION_STORAGE_KEYS } from "../../background/storage-keys";
import {
  getFiledReturnsCompletionStatus,
  getFiledReturnsSummaryHeading,
  getScopeMatchedFiledReturnsSummary,
  hasUnresolvedFiledReturnsRecovery,
} from "./flow-summary";
export function usePackPopupController() {
  const [status, setStatus] = React.useState("Loading Pack context...");
  const [scope, setScopeState] = React.useState<FiledReturnsDownloadScope>(
    DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE,
  );
  const [context, setContext] = React.useState<PortalContext | null>(null);
  const [filedReturnsObservation, setFiledReturnsObservation] =
    React.useState<PortalObservation | null>(null);
  const [filedReturnsFlowSummary, setFiledReturnsFlowSummary] =
    React.useState<FiledReturnsFlowSummary | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const showActionError = React.useCallback((message: string) => {
    setActionError(message);
    setStatus(message);
  }, []);
  React.useEffect(() => {
    void Promise.all([
      sendPackMessage({ type: "PACK_GET_CONTEXT" }),
      sendPackMessage({ type: "PACK_GET_FILED_RETURNS_OBSERVATION" }),
      sendPackMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }),
    ])
      .then(([contextResponse, observationResponse, summaryResponse]) => {
        if (observationResponse.ok && "observation" in observationResponse) {
          setFiledReturnsObservation(observationResponse.observation);
        }
        if (summaryResponse.ok && "flowSummary" in summaryResponse) {
          const flowSummary = summaryResponse.flowSummary;
          setFiledReturnsFlowSummary(flowSummary);
          if (flowSummary) setScopeState(flowSummary.scope);
        }

        if (contextResponse.ok && "context" in contextResponse) {
          setContext(contextResponse.context);
          setStatus(
            contextResponse.context?.supported
              ? "GST context detected."
              : "Pack is dormant until you start an action.",
          );
        } else {
          showActionError(contextResponse.ok ? "Unexpected Pack response." : contextResponse.error);
        }
      })
      .catch(() => showActionError("Pack could not read the current GST Portal state. Try again."));
  }, [showActionError]);

  /**
   * Re-reads the portal context on demand.
   *
   * The popup is short-lived and the mount read above is all it can ever need. The panel is
   * an ordinary extension page that stays mounted while the user opens, signs into, or
   * navigates the GST tab, so it calls this when its own document regains focus and would
   * otherwise show portal state from whenever it was opened.
   *
   * Deliberately narrower than the mount effect: re-running that would also reset `scope`
   * from the saved run, discarding a selection the user is part-way through making.
   */
  const refreshPortalContext = React.useCallback(async () => {
    try {
      const response = await sendPackMessage({ type: "PACK_GET_CONTEXT" });
      if (response.ok && "context" in response) {
        setContext(response.context);
        // A refresh that succeeds clears the error a previous refresh set.
        // getPopupPresentationState reads actionError before the refreshed
        // context, so leaving it would keep a recovered surface showing a
        // failure that no longer applies.
        setActionError(null);
        setStatus(
          response.context?.supported
            ? "GST context detected."
            : "Pack is dormant until you start an action.",
        );
        return;
      }
      showActionError(response.ok ? "Unexpected Pack response." : response.error);
    } catch {
      showActionError("Pack could not read the current GST Portal state. Try again.");
    }
  }, [showActionError]);

  React.useEffect(() => {
    const onChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      // Reacting to the key changing at all, not to it gaining a value: a
      // removal carries no `newValue`, so clearing local data left an already
      // open surface rendering a summary that no longer exists. The popup is
      // short-lived enough to have hidden this; the panel page is not.
      if (
        areaName !== "session" ||
        !changes[PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary]
      ) {
        return;
      }
      void sendPackMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }).then((response) => {
        if (!response.ok || !("flowSummary" in response)) return;
        setFiledReturnsFlowSummary(response.flowSummary ?? null);
        // The scope is the user's own selection, so it is only adopted from a
        // summary that exists; a clear must not silently reset what they chose.
        if (response.flowSummary) setScopeState(response.flowSummary.scope);
      });
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  const applyFlowResponse = React.useCallback(
    (response: PackMessageResponse) => {
      if (response.ok && "flowStep" in response) {
        setActionError(null);
        setStatus(response.flowStep.safeMessage);
        if ("flowSummary" in response && response.flowSummary) {
          setFiledReturnsFlowSummary(response.flowSummary);
          setScopeState(response.flowSummary.scope);
        }
        if ("observation" in response) {
          setFiledReturnsObservation(response.observation);
        }
      } else {
        showActionError(
          response.ok ? "Unexpected Pack response." : (response.safeMessage ?? response.error),
        );
      }
    },
    [showActionError],
  );

  const withBusy = React.useCallback(
    async (name: string, action: () => Promise<void>) => {
      setBusy(name);
      try {
        await action();
      } catch {
        showActionError("Pack could not reach the background service. Try the action again.");
      } finally {
        setBusy(null);
      }
    },
    [showActionError],
  );

  /**
   * `override` lets a caller start a scope it has just chosen, without waiting a render for
   * the state update to land. The panel's presets need this; the popup calls it with no
   * argument and is unaffected.
   */
  const startFiledReturnsFlow = React.useCallback(
    async (override?: FiledReturnsDownloadScope) => {
      const target = normaliseFiledReturnsScope(override ?? scope);
      if (override) setScopeState(target);
      await withBusy("start-filed-returns-flow", async () => {
        const response = await sendPackMessage({
          type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
          payload: target,
        });
        applyFlowResponse(response);
      });
    },
    [applyFlowResponse, scope, withBusy],
  );

  const acknowledgeInterruptedRun = React.useCallback(async () => {
    await withBusy("acknowledge-interrupted-run", async () => {
      const response = await sendPackMessage({ type: "PACK_ACKNOWLEDGE_INTERRUPTED_RUN" });
      if (response.ok && "flowStep" in response) {
        setActionError(null);
        setStatus(response.flowStep.safeMessage);
        setFiledReturnsFlowSummary(null);
      } else {
        showActionError(
          response.ok ? "Unexpected Pack response." : (response.safeMessage ?? response.error),
        );
      }
    });
  }, [showActionError, withBusy]);

  const retryFiledReturnsTarget = React.useCallback(async () => {
    const recoveryScope = filedReturnsFlowSummary?.scope;
    if (!recoveryScope) return;

    await withBusy("retry-filed-returns-target", async () => {
      const response = await sendPackMessage({
        type: "PACK_RETRY_FILED_RETURNS_TARGET",
        payload: recoveryScope,
      });
      applyFlowResponse(response);
    });
  }, [applyFlowResponse, filedReturnsFlowSummary?.scope, withBusy]);

  const resolveUnconfirmedDownload = React.useCallback(
    async (resolution: "manually-observed" | "cancelled") => {
      const recoveryScope = filedReturnsFlowSummary?.scope;
      if (!recoveryScope) return;

      await withBusy(
        resolution === "manually-observed"
          ? "resolve-unconfirmed-download"
          : "cancel-unconfirmed-download",
        async () => {
          const response = await sendPackMessage({
            type: "PACK_RESOLVE_UNCONFIRMED_DOWNLOAD",
            payload: {
              scope: recoveryScope,
              resolution,
            },
          });
          applyFlowResponse(response);
        },
      );
    },
    [applyFlowResponse, filedReturnsFlowSummary?.scope, withBusy],
  );

  const getFullFiscalYearRecoveryPayload =
    React.useCallback((): FullFiscalYearTargetRecoveryPayload | null => {
      const recovery = filedReturnsFlowSummary?.fullFiscalYearRecovery;
      if (!recovery) return null;
      return {
        ledgerId: recovery.ledgerId,
        targetId: recovery.targetId,
        expectedRevision: recovery.expectedRevision,
      };
    }, [filedReturnsFlowSummary?.fullFiscalYearRecovery]);

  const startFreshFiledReturnsFlow = React.useCallback(async () => {
    if (!filedReturnsFlowSummary || !hasUnresolvedFiledReturnsRecovery(filedReturnsFlowSummary)) {
      return;
    }
    const fullFiscalYearRecovery = getFullFiscalYearRecoveryPayload();
    const recovery = fullFiscalYearRecovery
      ? { kind: "full-fiscal-year" as const, ...fullFiscalYearRecovery }
      : { kind: "target-review" as const, scope: filedReturnsFlowSummary.scope };

    await withBusy("start-fresh-filed-returns-flow", async () => {
      const response = await sendPackMessage({
        type: "PACK_START_FRESH_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          scope: normaliseFiledReturnsScope(scope),
          recovery,
        },
      });
      applyFlowResponse(response);
    });
  }, [
    applyFlowResponse,
    filedReturnsFlowSummary,
    getFullFiscalYearRecoveryPayload,
    scope,
    withBusy,
  ]);
  const retryFullFiscalYearTarget = React.useCallback(async () => {
    const payload = getFullFiscalYearRecoveryPayload();
    if (!payload) return;

    await withBusy("retry-full-fiscal-year-target", async () => {
      const response = await sendPackMessage({
        type: "PACK_RETRY_FULL_FISCAL_YEAR_TARGET",
        payload,
      });
      applyFlowResponse(response);
    });
  }, [applyFlowResponse, getFullFiscalYearRecoveryPayload, withBusy]);

  const resolveFullFiscalYearTarget = React.useCallback(
    async (resolution: "manually-observed" | "cancelled") => {
      const payload = getFullFiscalYearRecoveryPayload();
      if (!payload) return;

      await withBusy(
        resolution === "manually-observed"
          ? "resolve-full-fiscal-year-target"
          : "cancel-full-fiscal-year-target",
        async () => {
          const response = await sendPackMessage({
            type: "PACK_RESOLVE_FULL_FISCAL_YEAR_TARGET",
            payload: {
              ...payload,
              resolution,
            },
          });
          applyFlowResponse(response);
        },
      );
    },
    [applyFlowResponse, getFullFiscalYearRecoveryPayload, withBusy],
  );

  const completionStatus = getFiledReturnsCompletionStatus(scope, filedReturnsFlowSummary);
  const recoverySummary = hasUnresolvedFiledReturnsRecovery(filedReturnsFlowSummary)
    ? filedReturnsFlowSummary
    : null;
  const scopeLockedForReview = recoverySummary !== null;
  const setScope = React.useCallback((nextScope: FiledReturnsDownloadScope) => {
    setScopeState(nextScope);
  }, []);
  const scopedFlowSummary = getScopeMatchedFiledReturnsSummary(scope, filedReturnsFlowSummary);
  const summaryHeading = scopedFlowSummary
    ? getFiledReturnsSummaryHeading(scope, scopedFlowSummary)
    : null;
  const effectiveBusy = scopedFlowSummary?.status === "complete" ? null : busy;
  return {
    acknowledgeInterruptedRun,
    actionError,
    completionStatus,
    context,
    effectiveBusy,
    filedReturnsObservation,
    lastRunSummary: filedReturnsFlowSummary,
    recoverySummary,
    refreshPortalContext,
    resolveFullFiscalYearTarget,
    resolveUnconfirmedDownload,
    retryFiledReturnsTarget,
    retryFullFiscalYearTarget,
    scope,
    scopeLockedForReview,
    scopedFlowSummary,
    setScope,
    startFiledReturnsFlow,
    startFreshFiledReturnsFlow,
    status,
    summaryHeading,
  };
}

async function sendPackMessage(message: PackMessage): Promise<PackMessageResponse> {
  return browser.runtime.sendMessage(message) as Promise<PackMessageResponse>;
}

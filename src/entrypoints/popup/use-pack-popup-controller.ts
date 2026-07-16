import React from "react";
import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalContext,
  PortalObservation,
} from "../../core/contracts";
import type {
  FullFiscalYearTargetRecoveryPayload,
  PackMessage,
  PackMessageResponse,
} from "../../core/messages";
import {
  DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE,
  normaliseFiledReturnsScope,
} from "../../core/filed-returns-scope";
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

  React.useEffect(() => {
    void Promise.all([
      sendPackMessage({ type: "PACK_GET_CONTEXT" }),
      sendPackMessage({ type: "PACK_GET_FILED_RETURNS_OBSERVATION" }),
      sendPackMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }),
    ]).then(([contextResponse, observationResponse, summaryResponse]) => {
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
        setStatus(contextResponse.ok ? "Unexpected Pack response." : contextResponse.error);
      }
    });
  }, []);

  const applyFlowResponse = React.useCallback((response: PackMessageResponse) => {
    if (response.ok && "flowStep" in response) {
      setStatus(response.flowStep.safeMessage);
      if ("flowSummary" in response && response.flowSummary) {
        setFiledReturnsFlowSummary(response.flowSummary);
        setScopeState(response.flowSummary.scope);
      }
      if ("observation" in response) {
        setFiledReturnsObservation(response.observation);
      }
    } else {
      setStatus(response.ok ? "Unexpected Pack response." : response.error);
    }
  }, []);

  const withBusy = React.useCallback(async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }, []);

  const startFiledReturnsFlow = React.useCallback(async () => {
    await withBusy("start-filed-returns-flow", async () => {
      const response = await sendPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: normaliseFiledReturnsScope(scope),
      });
      applyFlowResponse(response);
    });
  }, [applyFlowResponse, scope, withBusy]);

  const acknowledgeInterruptedRun = React.useCallback(async () => {
    await withBusy("acknowledge-interrupted-run", async () => {
      const response = await sendPackMessage({ type: "PACK_ACKNOWLEDGE_INTERRUPTED_RUN" });
      if (response.ok && "flowStep" in response) {
        setStatus(response.flowStep.safeMessage);
        setFiledReturnsFlowSummary(null);
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
    });
  }, [withBusy]);

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
    async (resolution: "downloaded" | "cancelled") => {
      const recoveryScope = filedReturnsFlowSummary?.scope;
      if (!recoveryScope) return;

      await withBusy(
        resolution === "downloaded"
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
    completionStatus,
    context,
    effectiveBusy,
    filedReturnsObservation,
    recoverySummary,
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

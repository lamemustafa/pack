import React from "react";
import { browser } from "wxt/browser";
import type { PortalContext } from "../../core/contracts";
import type {
  FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  FiledReturnsAllSupportedFullFiscalYearRequest,
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import type {
  AllSupportedFullFiscalYearTargetRecoveryPayload,
  FullFiscalYearTargetRecoveryPayload,
  PackMessage,
  PackMessageResponse,
} from "../../connectors/gst/messages";
import {
  DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE,
  normaliseFiledReturnsScope,
} from "../../connectors/gst/filed-returns-scope";
import {
  FILED_RETURNS_PLAN_STORAGE_KEY_PREFIX,
  ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_STORAGE_KEY_PREFIX,
  PACK_LOCAL_STORAGE_KEYS,
  PACK_SESSION_STORAGE_KEYS,
} from "../../background/storage-keys";
import {
  getScopeMatchedFiledReturnsSummary,
  hasUnresolvedFiledReturnsRecovery,
} from "./flow-summary";

export const PACK_ACTION_STOPPED_MESSAGE =
  "Pack stopped responding before that finished. Reopen Pack to see what was saved.";

/**
 * How often an open surface re-reads the summary while it shows a run in progress (#368).
 *
 * A run becomes interrupted by the clock alone: a dead worker writes nothing and never removes its
 * lease, so no storage event fires. The background decides staleness -- `ACTIVE_RUN_REVIEW_MS` in
 * `filed-returns-active-run.ts` for a run lease, `isAllSupportedFullFiscalYearLedgerStale` for an
 * all-supported ledger -- and this interval only bounds how long after that the open surface
 * notices. It is a latency choice, not derived from either. A hidden page's timers are throttled,
 * which degrades this to updating when the reader returns -- what reopening already did.
 */
export const PACK_RUNNING_SUMMARY_REFRESH_MS = 10_000;

const UNEXPECTED_PACK_RESPONSE = "Unexpected Pack response.";

export function usePackPopupController() {
  const [scope, setScopeState] = React.useState<FiledReturnsDownloadScope>(() =>
    normaliseFiledReturnsScope(DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE),
  );
  const [context, setContext] = React.useState<PortalContext | null>(null);
  const [filedReturnsFlowSummary, setFiledReturnsFlowSummary] =
    React.useState<FiledReturnsFlowSummary | null>(null);
  const [allSupportedFullFiscalYearFlowSummary, setAllSupportedFullFiscalYearFlowSummary] =
    React.useState<FiledReturnsAllSupportedFullFiscalYearFlowSummary | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const summaryRefreshEpoch = React.useRef(0);
  // The epoch of the latest summary refresh that owes a scope adoption it has not yet applied.
  const adoptingRefreshEpoch = React.useRef<number | null>(null);
  // `actionError` is shared with flow actions, so a successful context refresh
  // must clear only an error the context read itself produced. Clearing it
  // unconditionally wiped an unrelated download failure whenever the panel
  // regained focus.
  // Which kind of failure the displayed error belongs to. A boolean maintained
  // only by the context path went stale: a later flow failure replaced the
  // message without clearing the marker, so the next successful refresh cleared
  // a flow error it did not own and hid a live diagnostic.
  const actionErrorSource = React.useRef<"action" | "context" | "summary" | null>(null);
  const showActionError = React.useCallback(
    (message: string, source: "action" | "context" | "summary" = "action") => {
      actionErrorSource.current = source;
      setActionError(message);
    },
    [],
  );
  React.useEffect(() => {
    const summaryEpoch = ++summaryRefreshEpoch.current;
    void Promise.all([
      sendPackMessage({ type: "PACK_GET_CONTEXT" }),
      sendPackMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }),
    ])
      .then(([contextResponse, summaryResponse]) => {
        if (summaryEpoch === summaryRefreshEpoch.current) {
          if (summaryResponse.ok) {
            if ("allSupportedFullFiscalYearFlowSummary" in summaryResponse) {
              setAllSupportedFullFiscalYearFlowSummary(
                summaryResponse.allSupportedFullFiscalYearFlowSummary,
              );
              setFiledReturnsFlowSummary(null);
            } else if ("flowSummary" in summaryResponse) {
              const flowSummary = summaryResponse.flowSummary;
              setFiledReturnsFlowSummary(flowSummary);
              setAllSupportedFullFiscalYearFlowSummary(null);
              if (flowSummary) setScopeState(flowSummary.scope);
            } else {
              showActionError(UNEXPECTED_PACK_RESPONSE, "summary");
            }
          } else {
            showActionError(
              summaryResponse.safeMessage ??
                "Pack could not read saved local recovery state. Try again.",
              "summary",
            );
          }
        }

        if (contextResponse.ok && "context" in contextResponse) {
          setContext(contextResponse.context);
        } else {
          showActionError(
            contextResponse.ok
              ? UNEXPECTED_PACK_RESPONSE
              : (contextResponse.safeMessage ?? contextResponse.error),
            "context",
          );
        }
      })
      .catch(() =>
        showActionError("Pack could not read the current GST Portal state. Try again.", "context"),
      );
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
        // A refresh that succeeds clears the error a previous refresh set, and
        // only that: getPopupPresentationState reads actionError before the
        // refreshed context, so leaving a context error would keep a recovered
        // surface showing a failure that no longer applies — while clearing a
        // flow failure would hide one that still does.
        if (actionErrorSource.current === "context") {
          actionErrorSource.current = null;
          setActionError(null);
        }
        return;
      }
      showActionError(
        response.ok ? UNEXPECTED_PACK_RESPONSE : (response.safeMessage ?? response.error),
        "context",
      );
    } catch {
      showActionError("Pack could not read the current GST Portal state. Try again.", "context");
    }
  }, [showActionError]);

  /**
   * Re-reads the saved run without touching the scope.
   *
   * The storage listener below answers every change to the summary, which covers a run that
   * is progressing. It cannot cover a run that has stopped: a stall writes nothing, so the
   * event that would prompt a re-read is exactly the event a stall withholds. The background
   * decides staleness from elapsed time and will report an interrupted run the moment it is
   * asked -- so returning to this page has to ask, or the panel keeps rendering "Run in
   * progress" for a run that ended, under a promise that retry controls arrive on their own.
   *
   * Deliberately does not adopt `scope` from the response, unlike the mount effect and the
   * storage listener: the user may be part-way through a selection when they come back, and
   * that selection is theirs, not the saved run's.
   */
  const refreshFlowSummary = React.useCallback(
    async (adoptSummaryScope = false) => {
      const refreshEpoch = ++summaryRefreshEpoch.current;
      // A refresh that directly supersedes one still owing an adoption inherits it; a read that
      // completes, even with a failure, owes nothing further. Otherwise a running-run tick or a
      // focus refresh landing while a storage event's read is in flight discards that read and
      // never adopts: the new run's summary then sits under the old scope, matches nothing, and
      // the running run disappears from view while it is still running.
      const adoptScope = adoptSummaryScope || adoptingRefreshEpoch.current === refreshEpoch - 1;
      adoptingRefreshEpoch.current = adoptScope ? refreshEpoch : null;
      try {
        const response = await sendPackMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" });
        if (refreshEpoch !== summaryRefreshEpoch.current) return;
        adoptingRefreshEpoch.current = null;
        if (response.ok && "allSupportedFullFiscalYearFlowSummary" in response) {
          setAllSupportedFullFiscalYearFlowSummary(response.allSupportedFullFiscalYearFlowSummary);
          setFiledReturnsFlowSummary(null);
          if (actionErrorSource.current === "summary") {
            actionErrorSource.current = null;
            setActionError(null);
          }
          return;
        }
        if (response.ok && "flowSummary" in response) {
          setFiledReturnsFlowSummary(response.flowSummary ?? null);
          setAllSupportedFullFiscalYearFlowSummary(null);
          if (adoptScope && response.flowSummary) setScopeState(response.flowSummary.scope);
          if (actionErrorSource.current === "summary") {
            actionErrorSource.current = null;
            setActionError(null);
          }
          return;
        }
        showActionError(
          response.ok
            ? UNEXPECTED_PACK_RESPONSE
            : (response.safeMessage ??
                "Pack could not read saved local recovery state. Try again."),
          "summary",
        );
      } catch {
        if (refreshEpoch !== summaryRefreshEpoch.current) return;
        adoptingRefreshEpoch.current = null;
        showActionError("Pack could not read saved local recovery state. Try again.", "summary");
      }
    },
    [showActionError],
  );

  // Gated on a run being shown as running, so an idle surface never polls and the timer stops on its
  // own once the projection settles. The refresh keeps the reader's own scope selection.
  const showsRunningRun =
    allSupportedFullFiscalYearFlowSummary?.status === "running" ||
    filedReturnsFlowSummary?.status === "running";
  React.useEffect(() => {
    if (!showsRunningRun) return;
    const timer = setInterval(() => void refreshFlowSummary(), PACK_RUNNING_SUMMARY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshFlowSummary, showsRunningRun]);

  React.useEffect(() => {
    const onChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      const activeRunChange = changes[PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun];
      const leaseOnlyRemoval =
        areaName === "local" &&
        Object.keys(changes).length === 1 &&
        activeRunChange !== undefined &&
        !("newValue" in activeRunChange);
      if (leaseOnlyRemoval) return;
      // Reacting to the key changing at all, not to it gaining a value: a
      // removal carries no `newValue`, so clearing local data left an already
      // open surface rendering a summary that no longer exists. The popup is
      // short-lived enough to have hidden this; the panel page is not.
      const summaryChanged =
        (areaName === "session" &&
          Boolean(changes[PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary])) ||
        (areaName === "local" &&
          [
            PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun,
            PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedger,
            PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedgerIndex,
            PACK_LOCAL_STORAGE_KEYS.allSupportedFullFiscalYearLedgerIndex,
            PACK_LOCAL_STORAGE_KEYS.targetReview,
          ].some((key) => Boolean(changes[key]))) ||
        Object.keys(changes).some(
          (key) =>
            key.startsWith(FILED_RETURNS_PLAN_STORAGE_KEY_PREFIX) ||
            key.startsWith(ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_STORAGE_KEY_PREFIX),
        );
      if (!summaryChanged) {
        return;
      }
      // The run ledger is local and advances once per target. The session summary is
      // terminal-only, so both must trigger the same canonical summary read.
      void refreshFlowSummary(true);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      summaryRefreshEpoch.current += 1;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [refreshFlowSummary]);

  const applyFlowResponse = React.useCallback(
    (response: PackMessageResponse) => {
      if (response.ok && "allSupportedFullFiscalYearFlowSummary" in response) {
        summaryRefreshEpoch.current += 1;
        actionErrorSource.current = null;
        setActionError(null);
        setAllSupportedFullFiscalYearFlowSummary(response.allSupportedFullFiscalYearFlowSummary);
        setFiledReturnsFlowSummary(null);
      } else if (response.ok && "flowStep" in response) {
        summaryRefreshEpoch.current += 1;
        if ("flowSummary" in response && response.flowSummary) {
          actionErrorSource.current = null;
          setActionError(null);
          setFiledReturnsFlowSummary(response.flowSummary);
          setAllSupportedFullFiscalYearFlowSummary(null);
          setScopeState(response.flowSummary.scope);
        } else {
          showActionError(response.flowStep.safeMessage);
        }
      } else {
        showActionError(
          response.ok ? UNEXPECTED_PACK_RESPONSE : (response.safeMessage ?? response.error),
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
        // Deliberately does not promise that nothing was lost: `restart-*` discards a completed plan
        // before starting again, so an interruption part-way through is not a no-op. What does hold
        // for every action here is that Pack persists state before and after each step, so the saved
        // state -- not this message -- is where the reader finds out what happened. "Try the action
        // again" used to send them to repeat something that may already have fired (#374).
        showActionError(PACK_ACTION_STOPPED_MESSAGE);
      } finally {
        setBusy(null);
      }
    },
    [showActionError],
  );

  const startFiledReturnsFlow = React.useCallback(
    async (requestedScope?: FiledReturnsDownloadScope) => {
      const target = normaliseFiledReturnsScope(requestedScope ?? scope);
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

  const startAllSupportedFullFiscalYearFlow = React.useCallback(
    async (plan: FiledReturnsAllSupportedFullFiscalYearRequest) => {
      await withBusy("start-all-supported-filed-returns-full-fiscal-year-flow", async () => {
        const response = await sendPackMessage({
          type: "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW",
          payload: {
            kind: plan.kind,
            financialYear: plan.financialYear,
          },
        });
        applyFlowResponse(response);
      });
    },
    [applyFlowResponse, withBusy],
  );

  const restartAllSupportedFullFiscalYearFlow = React.useCallback(
    async (plan: FiledReturnsAllSupportedFullFiscalYearRequest & { ledgerId: string }) => {
      await withBusy("restart-all-supported-filed-returns-full-fiscal-year-flow", async () => {
        const response = await sendPackMessage({
          type: "PACK_RESTART_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW",
          payload: {
            kind: plan.kind,
            financialYear: plan.financialYear,
            // Names the ledger the reader reviewed. The background refuses when
            // the indexed ledger for this root has been replaced since.
            ledgerId: plan.ledgerId,
          },
        });
        applyFlowResponse(response);
      });
    },
    [applyFlowResponse, withBusy],
  );

  const retryAllSupportedFullFiscalYearTarget = React.useCallback(
    async (payload: AllSupportedFullFiscalYearTargetRecoveryPayload) => {
      await withBusy("retry-all-supported-filed-returns-full-fiscal-year-target", async () => {
        const response = await sendPackMessage({
          type: "PACK_RETRY_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_TARGET",
          payload,
        });
        applyFlowResponse(response);
        // A removed plan cannot supply an all-supported summary. Its flow step
        // is authoritative for this action, so leaving the prior summary up
        // would keep a retry control bound to a ledger that no longer exists.
        if (
          response.ok &&
          "flowStep" in response &&
          !("flowSummary" in response) &&
          !("allSupportedFullFiscalYearFlowSummary" in response)
        ) {
          setAllSupportedFullFiscalYearFlowSummary(null);
        }
      });
    },
    [applyFlowResponse, withBusy],
  );

  const acknowledgeInterruptedRun = React.useCallback(async () => {
    await withBusy("acknowledge-interrupted-run", async () => {
      const response = await sendPackMessage({ type: "PACK_ACKNOWLEDGE_INTERRUPTED_RUN" });
      if (response.ok && "flowStep" in response) {
        actionErrorSource.current = null;
        setActionError(null);
        // Re-read rather than blank. Clearing a lease is often the step BEFORE recovery, not the end
        // of it: a plan that could not take over a stale lease routes here, and its retry becomes
        // available once the lease is gone. The storage listener deliberately ignores a lease-only
        // removal, so without this nothing re-reads and the still-unresolved plan vanishes until the
        // panel happens to lose and regain focus (#375 review). Awaited inside the busy action, so the
        // control reads "Clearing..." until the plan is back rather than flashing an empty panel.
        await refreshFlowSummary();
      } else {
        showActionError(
          response.ok ? UNEXPECTED_PACK_RESPONSE : (response.safeMessage ?? response.error),
        );
      }
    });
  }, [refreshFlowSummary, showActionError, withBusy]);

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

  const recoverySummary = hasUnresolvedFiledReturnsRecovery(filedReturnsFlowSummary)
    ? filedReturnsFlowSummary
    : null;
  const scopeLockedForReview = recoverySummary !== null;
  const setScope = React.useCallback((nextScope: FiledReturnsDownloadScope) => {
    // The reader's own choice cancels any adoption a superseding refresh would otherwise inherit.
    adoptingRefreshEpoch.current = null;
    setScopeState(nextScope);
  }, []);
  const scopedFlowSummary = getScopeMatchedFiledReturnsSummary(scope, filedReturnsFlowSummary);
  const effectiveBusy = scopedFlowSummary?.status === "complete" ? null : busy;
  return {
    acknowledgeInterruptedRun,
    actionError,
    allSupportedFullFiscalYearFlowSummary,
    context,
    effectiveBusy,
    lastRunSummary: filedReturnsFlowSummary,
    recoverySummary,
    refreshFlowSummary,
    refreshPortalContext,
    resolveFullFiscalYearTarget,
    resolveUnconfirmedDownload,
    retryFiledReturnsTarget,
    retryFullFiscalYearTarget,
    restartAllSupportedFullFiscalYearFlow,
    retryAllSupportedFullFiscalYearTarget,
    scope,
    scopeLockedForReview,
    scopedFlowSummary,
    setScope,
    startFiledReturnsFlow,
    startAllSupportedFullFiscalYearFlow,
    startFreshFiledReturnsFlow,
  };
}

async function sendPackMessage(message: PackMessage): Promise<PackMessageResponse> {
  return browser.runtime.sendMessage(message) as Promise<PackMessageResponse>;
}

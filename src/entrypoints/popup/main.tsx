import React from "react";
import { createRoot } from "react-dom/client";
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
import "../../styles/global.css";
import { RecoveryActions, ScopeForm } from "./components";
import { getFiledReturnsCompletionStatus, getFiledReturnsSummaryHeading } from "./flow-summary";

function App() {
  const [status, setStatus] = React.useState("Loading Pack context...");
  const [scope, setScope] = React.useState<FiledReturnsDownloadScope>(
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
        if (flowSummary) setScope(flowSummary.scope);
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

  async function startFiledReturnsFlow() {
    await withBusy("start-filed-returns-flow", async () => {
      const response = await sendPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: normaliseFiledReturnsScope(scope),
      });
      applyFlowResponse(response);
    });
  }

  async function acknowledgeInterruptedRun() {
    await withBusy("acknowledge-interrupted-run", async () => {
      const response = await sendPackMessage({ type: "PACK_ACKNOWLEDGE_INTERRUPTED_RUN" });
      if (response.ok && "flowStep" in response) {
        setStatus(response.flowStep.safeMessage);
        setFiledReturnsFlowSummary(null);
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
    });
  }

  async function retryFiledReturnsTarget() {
    const recoveryScope = filedReturnsFlowSummary?.scope;
    if (!recoveryScope) return;

    await withBusy("retry-filed-returns-target", async () => {
      const response = await sendPackMessage({
        type: "PACK_RETRY_FILED_RETURNS_TARGET",
        payload: recoveryScope,
      });
      applyFlowResponse(response);
    });
  }

  async function resolveUnconfirmedDownload(resolution: "downloaded" | "cancelled") {
    const recoveryScope = filedReturnsFlowSummary?.scope;
    if (!recoveryScope) return;

    await withBusy(
      resolution === "downloaded" ? "resolve-unconfirmed-download" : "cancel-unconfirmed-download",
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
  }

  async function retryFullFiscalYearTarget() {
    const payload = getFullFiscalYearRecoveryPayload();
    if (!payload) return;

    await withBusy("retry-full-fiscal-year-target", async () => {
      const response = await sendPackMessage({
        type: "PACK_RETRY_FULL_FISCAL_YEAR_TARGET",
        payload,
      });
      applyFlowResponse(response);
    });
  }

  async function resolveFullFiscalYearTarget(resolution: "manually-observed" | "cancelled") {
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
  }

  function applyFlowResponse(response: PackMessageResponse) {
    if (response.ok && "flowStep" in response) {
      setStatus(response.flowStep.safeMessage);
      if ("flowSummary" in response && response.flowSummary) {
        setFiledReturnsFlowSummary(response.flowSummary);
        setScope(response.flowSummary.scope);
      }
      if ("observation" in response) {
        setFiledReturnsObservation(response.observation);
      }
    } else {
      setStatus(response.ok ? "Unexpected Pack response." : response.error);
    }
  }

  async function withBusy(name: string, action: () => Promise<void>) {
    setBusy(name);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  function getFullFiscalYearRecoveryPayload(): FullFiscalYearTargetRecoveryPayload | null {
    const recovery = filedReturnsFlowSummary?.fullFiscalYearRecovery;
    if (!recovery) return null;
    return {
      ledgerId: recovery.ledgerId,
      targetId: recovery.targetId,
      expectedRevision: recovery.expectedRevision,
    };
  }

  const completionStatus = getFiledReturnsCompletionStatus(scope, filedReturnsFlowSummary);
  const summaryHeading = filedReturnsFlowSummary
    ? getFiledReturnsSummaryHeading(scope, filedReturnsFlowSummary)
    : null;

  return (
    <main className="popup-shell">
      <header className="brand-header">
        <img className="brand-logo" src="/brand/pack-logo-outlined.svg" alt="ComplyEaze Pack" />
        <p className="brand-mode">GST Return Pack</p>
        <h1 className="sr-only">ComplyEaze Pack GST Return Pack</h1>
      </header>

      <section className="state" aria-live="polite">
        <p>{completionStatus ?? status}</p>
        <p className="muted">
          {context === null
            ? "Open GST Portal and choose a filed GSTR-3B period to begin."
            : context.supported
              ? `Detected ${context.pageKind} on ${context.origin ?? "GST Portal"}.`
              : (context.requiredAction?.message ?? "This page is outside Pack V0 scope.")}
        </p>
      </section>

      <ScopeForm
        busy={busy}
        flowSummary={filedReturnsFlowSummary}
        scope={scope}
        onScopeChange={setScope}
        onStart={() => void startFiledReturnsFlow()}
      />

      {filedReturnsFlowSummary && summaryHeading ? (
        <section className="state">
          <p>{summaryHeading}</p>
          <p className="muted">{filedReturnsFlowSummary.flowStep.safeMessage}</p>
        </section>
      ) : filedReturnsObservation ? (
        <section className="state">
          <p>Filed returns status: {filedReturnsObservation.state}</p>
          <p className="muted">{filedReturnsObservation.safeMessage}</p>
        </section>
      ) : null}

      <RecoveryActions
        busy={busy}
        summary={filedReturnsFlowSummary}
        onAcknowledgeInterruptedRun={() => void acknowledgeInterruptedRun()}
        onRetryFullFiscalYearTarget={() => void retryFullFiscalYearTarget()}
        onRetryTarget={() => void retryFiledReturnsTarget()}
        onResolveFullFiscalYearTarget={(resolution) => void resolveFullFiscalYearTarget(resolution)}
        onResolveTarget={(resolution) => void resolveUnconfirmedDownload(resolution)}
      />

      <p className="fineprint">
        No credentials, cookies, OTP, CAPTCHA, or GST documents are sent to ComplyEaze.
      </p>
    </main>
  );
}

async function sendPackMessage(message: PackMessage): Promise<PackMessageResponse> {
  return browser.runtime.sendMessage(message) as Promise<PackMessageResponse>;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

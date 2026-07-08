import React from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import "../../styles/popup-target-summary.css";
import type { FiledReturnsFlowSummary, PortalContext } from "../../core/contracts";
import { ScopeForm } from "./components";
import { RecoveryActions, hasRecoveryActions } from "./recovery-actions";
import { RunProgress } from "./run-summary";
import { usePackPopupController } from "./use-pack-popup-controller";

function App() {
  const popup = usePackPopupController();
  const showRecovery = hasRecoveryActions(popup.scopedFlowSummary ?? null);
  const portalReady = popup.context?.supported === true;
  const portalStatus = getPortalStatus(popup.context, popup.scopedFlowSummary, popup.effectiveBusy);

  return (
    <main className="popup-shell">
      <header className="popup-topbar">
        <div className="popup-brand">
          <img
            className="popup-wordmark"
            src="/brand/pack-logo-outlined.svg"
            alt="ComplyEaze Pack"
          />
          <div className="popup-title-block">
            <h1>Pack</h1>
            <p>GST return PDF downloader</p>
          </div>
        </div>
        <span className={`state-pill state-pill-${portalStatus.tone}`}>{portalStatus.badge}</span>
      </header>

      <PortalStatusCard
        status={portalStatus}
        summary={popup.scopedFlowSummary}
        onOpenDownloads={() => void browser.downloads.showDefaultFolder()}
      />

      <ScopeForm
        busy={popup.effectiveBusy}
        context={popup.context}
        flowSummary={popup.scopedFlowSummary}
        scope={popup.scope}
        onScopeChange={popup.setScope}
        onStart={() => void popup.startFiledReturnsFlow()}
      />

      {showRecovery ? (
        <section className="run-stack" aria-label="Run status and recovery">
          <RecoveryActions
            busy={popup.effectiveBusy}
            portalReady={portalReady}
            summary={popup.scopedFlowSummary}
            onAcknowledgeInterruptedRun={() => void popup.acknowledgeInterruptedRun()}
            onRetryFullFiscalYearTarget={() => void popup.retryFullFiscalYearTarget()}
            onRetryTarget={() => void popup.retryFiledReturnsTarget()}
            onResolveFullFiscalYearTarget={(resolution) =>
              void popup.resolveFullFiscalYearTarget(resolution)
            }
            onResolveTarget={(resolution) => void popup.resolveUnconfirmedDownload(resolution)}
          />
        </section>
      ) : null}

      <footer className="fineprint" aria-label="Pack privacy boundary">
        <span>Runs locally. GST login and PDFs stay on your device.</span>
        <span className="fineprint-links">
          <a href="https://github.com/lamemustafa/pack#privacy" target="_blank" rel="noreferrer">
            Data handling
          </a>
          <span aria-hidden="true">·</span>
          <a href="https://github.com/lamemustafa/pack" target="_blank" rel="noreferrer">
            Source
          </a>
        </span>
      </footer>
    </main>
  );
}

interface PortalStatusCardState {
  badge: string;
  body: string;
  icon: string;
  kind: "needed" | "detected" | "unsupported" | "expired" | "downloading" | "success" | "error";
  primaryAction?: "open-gst" | "downloads";
  secondaryHref?: string;
  secondaryLabel?: string;
  title: string;
  tone: "needed" | "ready" | "warning" | "success" | "danger";
}

function PortalStatusCard({
  status,
  summary,
  onOpenDownloads,
}: {
  status: PortalStatusCardState;
  summary: FiledReturnsFlowSummary | null;
  onOpenDownloads: () => void;
}) {
  return (
    <section className={`portal-status-card portal-status-card-${status.tone}`}>
      <div className="status-icon" aria-hidden="true">
        {status.icon}
      </div>
      <div className="portal-status-content">
        <p className="section-label">GST Portal status</p>
        <h2>{status.title}</h2>
        <p>{status.body}</p>
        {status.kind === "downloading" && summary ? <RunProgress summary={summary} /> : null}
        <div className="status-actions">
          {status.primaryAction === "open-gst" ? (
            <a
              className="button-link"
              href="https://www.gst.gov.in"
              target="_blank"
              rel="noreferrer"
            >
              Open GST Portal
            </a>
          ) : null}
          {status.primaryAction === "downloads" ? (
            <>
              <a className="button-link secondary-button-link" href="#download-details">
                Download another
              </a>
              <button className="status-link-button" type="button" onClick={onOpenDownloads}>
                Open downloads
              </button>
            </>
          ) : null}
          {status.secondaryHref && status.secondaryLabel ? (
            <a className="text-link" href={status.secondaryHref} target="_blank" rel="noreferrer">
              {status.secondaryLabel}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function getPortalStatus(
  context: PortalContext | null,
  summary: FiledReturnsFlowSummary | null,
  busy: string | null,
): PortalStatusCardState {
  if (busy === "start-filed-returns-flow" || summary?.status === "running") {
    return {
      badge: "Portal detected",
      body: "Waiting for Chrome to save the PDF.",
      icon: "↓",
      kind: "downloading",
      title: "Downloading...",
      tone: "ready",
    };
  }

  if (summary?.status === "complete") {
    return {
      badge: "Saved",
      body: "The requested return file was saved through your browser.",
      icon: "✓",
      kind: "success",
      primaryAction: "downloads",
      title: "PDF saved",
      tone: "success",
    };
  }

  if (summary?.status === "blocked" || summary?.status === "cancelled") {
    const expired = summary.flowStep.safeSignals.includes("gst-login-tab-opened");
    return {
      badge: expired ? "Session expired" : "Needs attention",
      body: expired
        ? "Your GST session may have expired. Refresh the GST Portal and try again."
        : displaySafeError(summary),
      icon: "!",
      kind: expired ? "expired" : "error",
      title: expired ? "Refresh GST Portal" : "Download needs review",
      tone: expired ? "warning" : "danger",
    };
  }

  if (context?.pageKind === "gst-auth-landing" || context?.requiredAction?.type === "LOGIN") {
    return {
      badge: "Session expired",
      body: "Your GST session may have expired. Refresh the GST Portal and try again.",
      icon: "!",
      kind: "expired",
      title: "Refresh GST Portal",
      tone: "warning",
    };
  }

  if (context?.supported) {
    return {
      badge: "Portal detected",
      body: "Choose the return and period to download.",
      icon: "✓",
      kind: "detected",
      title: "GST Portal detected",
      tone: "ready",
    };
  }

  if (context?.pageKind === "unsupported") {
    return {
      badge: "Unsupported page",
      body: "Open a filed-return dashboard or supported return page in this browser.",
      icon: "!",
      kind: "unsupported",
      title: "Unsupported GST page",
      tone: "warning",
    };
  }

  return {
    badge: "Portal needed",
    body: "Sign in to GST Portal in this browser, then open Pack again.",
    icon: "⌂",
    kind: "needed",
    primaryAction: "open-gst",
    secondaryHref: "https://github.com/lamemustafa/pack#how-it-works",
    secondaryLabel: "How it works",
    title: "Open the GST Portal",
    tone: "needed",
  };
}

function displaySafeError(summary: FiledReturnsFlowSummary): string {
  if (summary.flowStep.safeSignals.includes("full-fiscal-year-zip-download-unconfirmed")) {
    return "Pack prepared the ZIP, but Chrome did not confirm the save. Retry the final handoff.";
  }
  return summary.flowStep.safeMessage || "Pack could not complete this download. Retry detection.";
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

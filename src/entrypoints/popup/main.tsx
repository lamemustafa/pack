import React from "react";
import { createRoot } from "react-dom/client";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import "../../styles/popup-target-summary.css";
import { filedReturnsArtifactLabel } from "../../core/filed-returns-artifacts";
import { ScopeForm } from "./components";
import { RecoveryActions, hasRecoveryActions } from "./recovery-actions";
import { RunEvidencePanel } from "./run-evidence-panel";
import { RunProgress } from "./run-summary";
import {
  createScopeFormModel,
  getScopeActionCopy,
  getScopeFormStartAction,
} from "./scope-form-model";
import { DownloadTargetSummary } from "./target-summary";
import { usePackPopupController } from "./use-pack-popup-controller";

function App() {
  const popup = usePackPopupController();
  const isWorkbenchSurface = isFullWorkbenchSurface();
  const showRecovery = hasRecoveryActions(popup.scopedFlowSummary ?? null);
  const formModel = createScopeFormModel(popup.scope);
  const startAction = getScopeFormStartAction(
    popup.scope,
    popup.scopedFlowSummary,
    popup.effectiveBusy,
    formModel.fullFiscalYear,
  );
  const actionCopy = getScopeActionCopy(popup.scope, formModel.fullFiscalYear);
  const portalReady = popup.context?.supported === true;

  return (
    <main
      className={
        isWorkbenchSurface ? "popup-shell popup-shell-workbench" : "popup-shell popup-shell-compact"
      }
    >
      {isWorkbenchSurface ? (
        <header className="brand-header">
          <div className="brand-title-block">
            <img
              className="brand-logo"
              src="/brand/pack-logo-outlined.svg"
              alt="ComplyEaze Pack"
            />
            <div>
              <p className="section-label">GST return downloader</p>
              <h1>Pack</h1>
            </div>
          </div>
          <div className="brand-badges" aria-label="Pack build status">
            <a
              className="workbench-link"
              href="/popup.html?surface=workbench"
              target="_blank"
              rel="noreferrer"
            >
              Open full workbench
            </a>
            <p className="brand-mode">Local-first</p>
            <p className="build-marker">No credential capture</p>
          </div>
        </header>
      ) : null}

      {isWorkbenchSurface ? null : (
        <section className="compact-popup-panel" aria-label="Pack quick action">
          <div className="compact-status-row">
            <div>
              <p className="section-label">Current setup</p>
              <h2>{popup.scope.returnType}</h2>
            </div>
            <span
              className={
                portalReady ? "state-pill state-pill-ready" : "state-pill state-pill-needed"
              }
            >
              {portalReady ? "Portal ready" : "Portal needed"}
            </span>
          </div>
          <dl className="compact-target-list">
            <div>
              <dt>FY</dt>
              <dd>{popup.scope.financialYear}</dd>
            </div>
            <div>
              <dt>Range</dt>
              <dd>{formModel.fullFiscalYear ? "Full year" : popup.scope.period}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>
                {formModel.selectedArtifactType === "PDF_AND_EXCEL"
                  ? "PDF + Excel ZIP"
                  : filedReturnsArtifactLabel(
                      formModel.selectedArtifactType,
                      popup.scope.returnType,
                    )}
              </dd>
            </div>
          </dl>
          {popup.scopedFlowSummary && popup.summaryHeading ? (
            <div className="compact-run-status">
              <div>
                <p className="section-label">Run status</p>
                <p>{popup.summaryHeading}</p>
              </div>
              <RunProgress summary={popup.scopedFlowSummary} />
            </div>
          ) : (
            <p className="compact-help">
              {portalReady
                ? actionCopy.summary
                : "Open a signed-in GST return dashboard or return page before starting."}
            </p>
          )}
          <button
            className="primary-action compact-primary-action"
            type="button"
            disabled={startAction.disabled}
            onClick={() => void popup.startFiledReturnsFlow()}
          >
            {startAction.label}
          </button>
          <a
            className="compact-workbench-link"
            href="/popup.html?surface=workbench"
            target="_blank"
            rel="noreferrer"
          >
            Edit setup and review details
          </a>
        </section>
      )}

      {isWorkbenchSurface ? (
        <>
          <DownloadTargetSummary
            completionStatus={popup.completionStatus}
            context={popup.context}
            scope={popup.scope}
            status={popup.status}
          />

          <section className="command-workbench" aria-label="GST return download workbench">
            <div className="scope-column">
              <ScopeForm
                busy={popup.effectiveBusy}
                context={popup.context}
                flowSummary={popup.scopedFlowSummary}
                scope={popup.scope}
                onScopeChange={popup.setScope}
                onStart={() => void popup.startFiledReturnsFlow()}
              />
            </div>

            <aside className="run-column" aria-label="Target, run status, and recovery">
              <RunEvidencePanel
                portalReady={popup.context?.supported === true}
                filedReturnsObservation={popup.filedReturnsObservation}
                scopedFlowSummary={popup.scopedFlowSummary}
                summaryHeading={popup.summaryHeading}
              />
              {showRecovery ? (
                <RecoveryActions
                  busy={popup.effectiveBusy}
                  portalReady={popup.context?.supported === true}
                  summary={popup.scopedFlowSummary}
                  onAcknowledgeInterruptedRun={() => void popup.acknowledgeInterruptedRun()}
                  onRetryFullFiscalYearTarget={() => void popup.retryFullFiscalYearTarget()}
                  onRetryTarget={() => void popup.retryFiledReturnsTarget()}
                  onResolveFullFiscalYearTarget={(resolution) =>
                    void popup.resolveFullFiscalYearTarget(resolution)
                  }
                  onResolveTarget={(resolution) =>
                    void popup.resolveUnconfirmedDownload(resolution)
                  }
                />
              ) : null}
            </aside>
          </section>
        </>
      ) : null}

      <footer className="fineprint" aria-label="Pack privacy boundary">
        <span>No credentials</span>
        <span>No cookies or OTPs</span>
        <span>No GST files sent to ComplyEaze</span>
      </footer>
    </main>
  );
}

function isFullWorkbenchSurface(): boolean {
  const surface = new URLSearchParams(globalThis.location.search).get("surface");
  return surface === "workbench";
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

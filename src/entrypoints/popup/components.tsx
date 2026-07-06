import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../../core/contracts";
import {
  FILED_RETURNS_ARTIFACT_TYPES,
  filedReturnsArtifactLabel,
  normaliseFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "../../core/filed-returns-artifacts";
import {
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsScopePeriodOptions,
  isFullFiscalYearScope,
  normaliseFiledReturnsScope,
} from "../../core/filed-returns-scope";
import { FILED_RETURNS_RETURN_TYPES } from "../../core/filed-returns-return-types";
import { ScopeButtonGroup } from "./scope-button-group";

export interface ScopeFormProps {
  busy: string | null;
  flowSummary?: FiledReturnsFlowSummary | null;
  scope: FiledReturnsDownloadScope;
  onScopeChange: (scope: FiledReturnsDownloadScope) => void;
  onStart: () => void;
}

export interface RecoveryActionsProps {
  busy: string | null;
  summary: FiledReturnsFlowSummary | null;
  onAcknowledgeInterruptedRun: () => void;
  onRetryFullFiscalYearTarget: () => void;
  onRetryTarget: () => void;
  onResolveFullFiscalYearTarget: (resolution: "manually-observed" | "cancelled") => void;
  onResolveTarget: (resolution: "downloaded" | "cancelled") => void;
}

export function RecoveryActions({
  busy,
  summary,
  onAcknowledgeInterruptedRun,
  onRetryFullFiscalYearTarget,
  onRetryTarget,
  onResolveFullFiscalYearTarget,
  onResolveTarget,
}: RecoveryActionsProps) {
  if (!summary) return null;

  const signals = new Set(summary.flowStep.safeSignals);
  const needsRunReview = signals.has("filed-returns-run-needs-review");
  const needsTargetReview = signals.has("filed-returns-target-review-required");
  const runActive =
    signals.has("filed-returns-run-active") || signals.has("full-fiscal-year-run-active");
  const needsFullFiscalYearReview =
    Boolean(summary.fullFiscalYearRecovery) &&
    (signals.has("full-fiscal-year-download-unconfirmed") ||
      signals.has("full-fiscal-year-run-interrupted") ||
      signals.has("full-fiscal-year-resume-confirmation-required") ||
      signals.has("full-fiscal-year-run-needs-action"));
  const canManuallyObserveFullYear = canManuallyObserveFullFiscalYearTarget(summary);
  if (!needsRunReview && !needsTargetReview && !needsFullFiscalYearReview && !runActive) {
    return null;
  }

  return (
    <section className="actions" aria-label="Filed return recovery actions">
      {runActive ? (
        <>
          <button type="button" disabled>
            Run in progress
          </button>
          <p className="muted">
            Retry controls appear automatically if the run stops making progress.
          </p>
        </>
      ) : null}
      {needsRunReview ? (
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={onAcknowledgeInterruptedRun}
        >
          {busy === "acknowledge-interrupted-run" ? "Resetting..." : "Reset stuck run"}
        </button>
      ) : null}
      {needsTargetReview ? (
        <>
          <button type="button" disabled={busy !== null} onClick={onRetryTarget}>
            {busy === "retry-filed-returns-target" ? "Retrying..." : "Retry this period"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy !== null}
            onClick={() => onResolveTarget("downloaded")}
          >
            {busy === "resolve-unconfirmed-download" ? "Saving..." : "Mark reviewed manually"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy !== null}
            onClick={() => onResolveTarget("cancelled")}
          >
            {busy === "cancel-unconfirmed-download" ? "Cancelling..." : "Cancel and reset"}
          </button>
        </>
      ) : null}
      {needsFullFiscalYearReview ? (
        <>
          <p className="muted">
            This saved run is not bound to a GST account. Continue only if the same GST account is
            currently open.
          </p>
          <button type="button" disabled={busy !== null} onClick={onRetryFullFiscalYearTarget}>
            {busy === "retry-full-fiscal-year-target" ? "Retrying..." : retryFullYearLabel(summary)}
          </button>
          {canManuallyObserveFullYear ? (
            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={() => onResolveFullFiscalYearTarget("manually-observed")}
            >
              {busy === "resolve-full-fiscal-year-target"
                ? "Saving..."
                : "Mark as manually observed"}
            </button>
          ) : null}
          <button
            type="button"
            className="secondary"
            disabled={busy !== null}
            onClick={() => onResolveFullFiscalYearTarget("cancelled")}
          >
            {busy === "cancel-full-fiscal-year-target"
              ? "Cancelling..."
              : cancelFullYearLabel(summary)}
          </button>
        </>
      ) : null}
    </section>
  );
}

export function canManuallyObserveFullFiscalYearTarget(
  summary: FiledReturnsFlowSummary | null,
): boolean {
  return summary?.fullFiscalYearRecovery?.targetStatus === "download-unconfirmed";
}

function retryFullYearLabel(summary: FiledReturnsFlowSummary): string {
  if (summary.flowStep.safeSignals.includes("full-fiscal-year-resume-confirmation-required")) {
    return "Resume saved run";
  }
  return summary.fullFiscalYearRecovery?.targetStatus === "pending"
    ? "Resume saved period"
    : "Retry this period";
}

function cancelFullYearLabel(summary: FiledReturnsFlowSummary): string {
  if (summary.flowStep.safeSignals.includes("full-fiscal-year-resume-confirmation-required")) {
    return "Discard saved run";
  }
  return "Cancel and reset";
}

export function ScopeForm({ busy, flowSummary, scope, onScopeChange, onStart }: ScopeFormProps) {
  const financialYearOptions = getFiledReturnsFinancialYearOptions();
  const periodOptions = getFiledReturnsScopePeriodOptions(
    scope.financialYear,
    new Date(),
    scope.returnType,
  );
  const artifactOptions = FILED_RETURNS_ARTIFACT_TYPES.filter((artifactType) =>
    supportsFiledReturnsArtifactType(scope.returnType, artifactType),
  );
  const selectedArtifactType = normaliseFiledReturnsArtifactType(
    scope.returnType,
    scope.artifactType,
  );
  const fullFiscalYear = isFullFiscalYearScope(scope);
  const startAction = getScopeFormStartAction(scope, flowSummary, busy, fullFiscalYear);

  return (
    <section className="flow-panel" aria-label="Filed return download scope">
      <ScopeButtonGroup
        label="Filing"
        value={scope.returnType}
        options={FILED_RETURNS_RETURN_TYPES.map((returnType) => ({
          value: returnType,
          label: returnType,
        }))}
        onChange={(returnType) =>
          onScopeChange(
            normaliseFiledReturnsScope({
              ...scope,
              returnType: returnType as FiledReturnsDownloadScope["returnType"],
            }),
          )
        }
      />
      <ScopeButtonGroup
        label="Download"
        value={selectedArtifactType}
        options={artifactOptions.map((artifactType) => ({
          value: artifactType,
          label: filedReturnsArtifactLabel(artifactType, scope.returnType),
        }))}
        onChange={(artifactType) =>
          onScopeChange(
            normaliseFiledReturnsScope({
              ...scope,
              artifactType: artifactType as NonNullable<FiledReturnsDownloadScope["artifactType"]>,
            }),
          )
        }
      />
      <ScopeButtonGroup
        label="Financial year"
        value={scope.financialYear}
        options={financialYearOptions.map((financialYear) => ({
          value: financialYear,
          label: financialYear,
        }))}
        onChange={(financialYear) =>
          onScopeChange(
            normaliseFiledReturnsScope({
              ...scope,
              financialYear,
            }),
          )
        }
      />
      <ScopeButtonGroup
        label="Period"
        value={scope.period}
        options={periodOptions}
        onChange={(period) => onScopeChange({ ...scope, period })}
      />
      {fullFiscalYear ? (
        <p className="muted">
          Runs eligible filed {scope.returnType} periods one by one from your signed-in GST Portal
          tab. Pack stops on ambiguous downloads and records local status only. Excel is available
          only when the GST Portal provides the selected GSTR-1 e-invoice details file.
        </p>
      ) : null}
      <button type="button" disabled={startAction.disabled} onClick={onStart}>
        {startAction.label}
      </button>
    </section>
  );
}

function getScopeFormStartAction(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null | undefined,
  busy: string | null,
  fullFiscalYear: boolean,
): { disabled: boolean; label: string } {
  if (busy === "start-filed-returns-flow") return { disabled: true, label: "Starting..." };
  if (busy !== null) return { disabled: true, label: defaultStartLabel(fullFiscalYear) };
  if (summary && isSameScope(scope, summary.scope)) {
    const signals = new Set(summary.flowStep.safeSignals);
    if (signals.has("filed-returns-run-active") || signals.has("full-fiscal-year-run-active")) {
      return { disabled: true, label: "Run in progress" };
    }
    if (signals.has("filed-returns-run-needs-review")) {
      return { disabled: true, label: "Reset stuck run first" };
    }
    if (
      signals.has("filed-returns-target-review-required") ||
      signals.has("full-fiscal-year-download-unconfirmed") ||
      signals.has("full-fiscal-year-run-interrupted") ||
      signals.has("full-fiscal-year-run-needs-action")
    ) {
      return { disabled: true, label: "Resolve current period first" };
    }
    if (signals.has("full-fiscal-year-resume-confirmation-required")) {
      return { disabled: true, label: "Resume or discard saved run" };
    }
  }
  return { disabled: false, label: defaultStartLabel(fullFiscalYear) };
}

function defaultStartLabel(fullFiscalYear: boolean): string {
  return fullFiscalYear ? "Start local full-year run" : "Start download";
}

function isSameScope(left: FiledReturnsDownloadScope, right: FiledReturnsDownloadScope): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType) ===
      normaliseFiledReturnsArtifactType(right.returnType, right.artifactType)
  );
}

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
      <div className="panel-heading">
        <p className="section-label">Setup</p>
        <h2>Return, period, and file format</h2>
      </div>
      <div className="scope-section scope-section-primary">
        <ScopeButtonGroup
          label="Return"
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
          label="File"
          value={selectedArtifactType}
          options={artifactOptions.map((artifactType) => ({
            value: artifactType,
            label: filedReturnsArtifactLabel(artifactType, scope.returnType),
          }))}
          onChange={(artifactType) =>
            onScopeChange(
              normaliseFiledReturnsScope({
                ...scope,
                artifactType: artifactType as NonNullable<
                  FiledReturnsDownloadScope["artifactType"]
                >,
              }),
            )
          }
        />
      </div>
      <div className="scope-section scope-section-period">
        <ScopeSelect
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
        <ScopeSelect
          label="Period"
          value={scope.period}
          options={periodOptions}
          onChange={(period) => onScopeChange({ ...scope, period })}
        />
      </div>
      {fullFiscalYear ? <p className="scope-note">{getFullFiscalYearNote(scope)}</p> : null}
      <button
        className="primary-action"
        type="button"
        disabled={startAction.disabled}
        onClick={onStart}
      >
        {startAction.label}
      </button>
    </section>
  );
}

function ScopeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const id = `scope-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label className="scope-select" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function getFullFiscalYearNote(scope: FiledReturnsDownloadScope): string {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const base =
    `Runs eligible filed ${scope.returnType} periods one by one from your signed-in GST ` +
    "Portal tab. Pack stops on ambiguous downloads and records local status only.";
  if (scope.returnType === "GSTR-2B" && artifactType === "PDF_AND_EXCEL") {
    return `${base} PDF and Excel are captured only from the portal-generated download controls.`;
  }
  if (scope.returnType === "GSTR-1" && artifactType !== "PDF") {
    return `${base} Excel is included only when the GST Portal provides the selected e-invoice details file.`;
  }
  return base;
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

import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalContext,
} from "../../core/contracts";
import {
  FULL_FISCAL_YEAR_PERIOD,
  normaliseFiledReturnsScope,
} from "../../core/filed-returns-scope";
import { ScopeActionPanel } from "./scope-action-panel";
import { ScopeButtonGroup } from "./scope-button-group";
import {
  createScopeFormModel,
  getScopeActionCopy,
  getScopeFormStartAction,
  getSinglePeriodFallback,
  returnTypeOptions,
} from "./scope-form-model";

export interface ScopeFormProps {
  busy: string | null;
  context: PortalContext | null;
  flowSummary?: FiledReturnsFlowSummary | null;
  scope: FiledReturnsDownloadScope;
  onScopeChange: (scope: FiledReturnsDownloadScope) => void;
  onStart: () => void;
  showPrimaryAction?: boolean;
}

export function ScopeForm({
  busy,
  context,
  flowSummary,
  scope,
  onScopeChange,
  onStart,
  showPrimaryAction = true,
}: ScopeFormProps) {
  const formModel = createScopeFormModel(scope);
  const multipleArtifactChoices = formModel.artifactOptions.length > 1;
  const controlsDisabled = busy !== null || flowSummary?.status === "running";

  return (
    <section id="download-details" className="flow-panel" aria-label="Download details">
      <div className="flow-panel-heading">
        <h2>Download GST returns</h2>
        <p>Choose a return and period to save through this browser.</p>
      </div>
      <div className="scope-form-grid">
        <div className="scope-row">
          <ScopeButtonGroup
            className="scope-group-return"
            label="Return"
            value={scope.returnType}
            options={returnTypeOptions()}
            disabled={controlsDisabled}
            onChange={(returnType) =>
              onScopeChange(
                normaliseFiledReturnsScope({
                  ...scope,
                  returnType: returnType as FiledReturnsDownloadScope["returnType"],
                }),
              )
            }
          />
        </div>
        <div className="scope-row scope-row-range">
          {formModel.supportsFullFiscalYear ? (
            <ScopeButtonGroup
              className="scope-group-run-mode"
              label="Range"
              value={formModel.fullFiscalYear ? "FULL_YEAR" : "SINGLE_PERIOD"}
              options={[
                {
                  value: "SINGLE_PERIOD",
                  label: "Single period",
                  description: "One month",
                },
                {
                  value: "FULL_YEAR",
                  label: "Full year",
                  description: "One ZIP",
                },
              ]}
              disabled={controlsDisabled}
              onChange={(mode) =>
                onScopeChange(
                  normaliseFiledReturnsScope({
                    ...scope,
                    period:
                      mode === "FULL_YEAR"
                        ? FULL_FISCAL_YEAR_PERIOD
                        : getSinglePeriodFallback(scope.period, formModel.singlePeriodOptions),
                  }),
                )
              }
            />
          ) : null}
          <div className="scope-select-row">
            <ScopeSelect
              label="FY"
              value={scope.financialYear}
              options={formModel.financialYearOptions}
              disabled={controlsDisabled}
              onChange={(financialYear) =>
                onScopeChange(
                  normaliseFiledReturnsScope({
                    ...scope,
                    financialYear,
                  }),
                )
              }
            />
            {formModel.fullFiscalYear ? null : (
              <ScopeSelect
                label="Period"
                value={scope.period}
                options={formModel.singlePeriodOptions}
                disabled={controlsDisabled}
                onChange={(period) => onScopeChange({ ...scope, period })}
              />
            )}
          </div>
        </div>
        {multipleArtifactChoices ? (
          <details className="advanced-options">
            <summary>More options</summary>
            <div className="scope-row">
              <ScopeSelect
                label="File format"
                value={formModel.selectedArtifactType}
                options={formModel.artifactOptions}
                disabled={controlsDisabled}
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
          </details>
        ) : null}
      </div>
      {showPrimaryAction ? (
        <ScopeFormAction
          busy={busy}
          context={context}
          flowSummary={flowSummary ?? null}
          scope={scope}
          onStart={onStart}
        />
      ) : null}
    </section>
  );
}

export function ScopeFormAction({
  busy,
  context,
  flowSummary,
  scope,
  onStart,
}: {
  busy: string | null;
  context: PortalContext | null;
  flowSummary?: FiledReturnsFlowSummary | null;
  scope: FiledReturnsDownloadScope;
  onStart: () => void;
}) {
  const formModel = createScopeFormModel(scope);
  const startAction = getScopeFormStartAction(scope, flowSummary, busy, formModel.fullFiscalYear);
  const actionCopy = getScopeActionCopy(scope, formModel.fullFiscalYear);
  const portalSupported = context?.supported === true;
  const disabledReason = portalSupported ? null : getPortalDisabledReason(context);

  return (
    <ScopeActionPanel
      actionCopy={actionCopy}
      busy={busy === "start-filed-returns-flow"}
      disabled={startAction.disabled || !portalSupported}
      disabledReason={disabledReason}
      label={startAction.label}
      onStart={onStart}
    />
  );
}

function getPortalDisabledReason(context: PortalContext | null): string {
  if (context?.pageKind === "gst-auth-landing" || context?.requiredAction?.type === "LOGIN") {
    return "Refresh or sign in to GST Portal to continue.";
  }
  if (context?.pageKind === "unsupported") return "Open a supported filed-return page.";
  return "Open GST Portal to continue.";
}

function ScopeSelect({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = `scope-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label className="scope-select" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

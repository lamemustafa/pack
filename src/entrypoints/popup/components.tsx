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
}

export function ScopeForm({
  busy,
  context,
  flowSummary,
  scope,
  onScopeChange,
  onStart,
}: ScopeFormProps) {
  const formModel = createScopeFormModel(scope);
  const startAction = getScopeFormStartAction(scope, flowSummary, busy, formModel.fullFiscalYear);
  const actionCopy = getScopeActionCopy(scope, formModel.fullFiscalYear);
  const portalSupported = context?.supported === true;
  const disabledReason = portalSupported ? null : getPortalDisabledReason(context);
  const actionDisabled = startAction.disabled || !portalSupported;
  const multipleArtifactChoices = formModel.artifactOptions.length > 1;

  return (
    <section className="flow-panel" aria-label="Download details">
      <div className="flow-panel-heading">
        <h2>Download details</h2>
        <p>Choose the filed return and period. Pack saves files through this browser.</p>
      </div>
      <div className="scope-form-grid">
        <div className="scope-row">
          <ScopeButtonGroup
            className="scope-group-return"
            label="Return"
            value={scope.returnType}
            options={returnTypeOptions()}
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
                onChange={(period) => onScopeChange({ ...scope, period })}
              />
            )}
            {formModel.fullFiscalYear && multipleArtifactChoices ? (
              <ScopeSelect
                label="Files"
                value={formModel.selectedArtifactType}
                options={formModel.artifactOptions}
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
            ) : null}
          </div>
        </div>
        {multipleArtifactChoices && !formModel.fullFiscalYear ? (
          <div className="scope-row">
            <ScopeSelect
              label="Files"
              value={formModel.selectedArtifactType}
              options={formModel.artifactOptions}
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
        ) : null}
      </div>
      <ScopeActionPanel
        actionCopy={actionCopy}
        busy={busy === "start-filed-returns-flow"}
        disabled={actionDisabled}
        disabledReason={disabledReason}
        label={startAction.label}
        onStart={onStart}
      />
    </section>
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

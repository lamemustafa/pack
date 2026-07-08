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
  const startAction = getScopeFormStartAction(
    scope,
    flowSummary,
    busy,
    formModel.fullFiscalYear,
    context,
  );
  const actionCopy = getScopeActionCopy(scope, formModel.fullFiscalYear);

  return (
    <section className="flow-panel" aria-label="Filed return download scope">
      <div className="panel-heading">
        <p className="section-label">Setup</p>
        <h2>Return, period, and file format</h2>
      </div>
      <div className="scope-form-grid">
        <div className="scope-section scope-section-primary">
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
          {formModel.supportsFullFiscalYear ? (
            <ScopeButtonGroup
              className="scope-group-run-mode"
              label="Run mode"
              value={formModel.fullFiscalYear ? "FULL_YEAR" : "SINGLE_PERIOD"}
              options={[
                { value: "SINGLE_PERIOD", label: "Single period" },
                { value: "FULL_YEAR", label: "Full fiscal year" },
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
          <ScopeButtonGroup
            className="scope-group-file"
            label="File"
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
        <div className="scope-action-column">
          <div className="scope-section scope-section-period">
            <ScopeSelect
              label="Financial year"
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
          </div>
          <ScopeActionPanel
            actionCopy={actionCopy}
            disabled={startAction.disabled}
            label={startAction.label}
            onStart={onStart}
          />
          {!context?.supported ? (
            <p className="scope-note scope-note-warning">
              Open a signed-in GST return dashboard or return page before starting. Pack will not
              open login pages or reuse stale portal state.
            </p>
          ) : null}
        </div>
      </div>
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

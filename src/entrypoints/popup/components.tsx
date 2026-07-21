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
import { canRetryFullFiscalYearZipWithoutPortal } from "./flow-summary";
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
  scopeLockedForReview?: boolean;
  onScopeChange: (scope: FiledReturnsDownloadScope) => void;
  onStart: () => void;
  showPrimaryAction?: boolean;
}

export function ScopeForm({
  busy,
  context,
  flowSummary,
  scope,
  scopeLockedForReview = false,
  onScopeChange,
  onStart,
  showPrimaryAction = true,
}: ScopeFormProps) {
  const formModel = createScopeFormModel(scope);
  const multipleArtifactChoices = formModel.artifactOptions.length > 1;
  const controlsDisabled =
    busy !== null ||
    flowSummary?.status === "running" ||
    canRetryFullFiscalYearZipWithoutPortal(flowSummary);

  return (
    <section id="download-details" className="flow-panel" aria-label="Download details">
      <div className="flow-panel-heading">
        <h2>Download GST records</h2>
        <p>Choose a return or statement and period to save through this browser.</p>
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
              value={
                formModel.fullFiscalYear
                  ? "FULL_YEAR"
                  : formModel.customRange
                    ? "CUSTOM_RANGE"
                    : "SINGLE_PERIOD"
              }
              options={[
                {
                  value: "SINGLE_PERIOD",
                  label: "Single period",
                  description: "One month",
                },
                ...(formModel.rangeEndOptions.length > 0
                  ? [
                      {
                        value: "CUSTOM_RANGE",
                        label: "Custom range",
                        description: "Contiguous months",
                      },
                    ]
                  : []),
                {
                  value: "FULL_YEAR",
                  label: "Full year",
                  description: "One ZIP",
                },
              ]}
              disabled={controlsDisabled}
              onChange={(mode) => {
                const period =
                  mode === "FULL_YEAR"
                    ? FULL_FISCAL_YEAR_PERIOD
                    : getSinglePeriodFallback(scope.period, formModel.singlePeriodOptions);
                if (mode === "CUSTOM_RANGE") {
                  const rangeEndPeriod = formModel.rangeEndOptions[0]?.value;
                  if (!rangeEndPeriod) return;
                  onScopeChange(normaliseFiledReturnsScope({ ...scope, period, rangeEndPeriod }));
                  return;
                }
                onScopeChange(normaliseFiledReturnsScope(scopeWithoutCustomRange(scope, period)));
              }}
            />
          ) : null}
          <div
            className={`scope-select-row${formModel.customRange ? " scope-select-row-custom-range" : ""}`}
          >
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
                label={formModel.customRange ? "Start" : "Period"}
                value={scope.period}
                options={
                  formModel.customRange
                    ? formModel.rangeStartOptions
                    : formModel.singlePeriodOptions
                }
                disabled={controlsDisabled}
                onChange={(period) => {
                  const candidateEndPeriod = formModel.singlePeriodOptions.find(
                    (option) => option.value === scope.rangeEndPeriod,
                  );
                  const periodIndex = formModel.singlePeriodOptions.findIndex(
                    (option) => option.value === period,
                  );
                  const candidateEndIndex = formModel.singlePeriodOptions.findIndex(
                    (option) => option.value === candidateEndPeriod?.value,
                  );
                  if (formModel.customRange) {
                    const rangeEndPeriod =
                      candidateEndIndex > periodIndex
                        ? candidateEndPeriod?.value
                        : formModel.singlePeriodOptions[periodIndex + 1]?.value;
                    if (!rangeEndPeriod) return;
                    onScopeChange(normaliseFiledReturnsScope({ ...scope, period, rangeEndPeriod }));
                    return;
                  }
                  onScopeChange(normaliseFiledReturnsScope({ ...scope, period }));
                }}
              />
            )}
            {formModel.customRange ? (
              <ScopeSelect
                label="End"
                value={scope.rangeEndPeriod ?? ""}
                options={formModel.rangeEndOptions}
                disabled={controlsDisabled}
                onChange={(rangeEndPeriod) =>
                  onScopeChange(
                    normaliseFiledReturnsScope({
                      ...scope,
                      rangeEndPeriod,
                    }),
                  )
                }
              />
            ) : null}
          </div>
        </div>
        {multipleArtifactChoices ? (
          <div className="advanced-options">
            <div className="scope-row">
              <ScopeButtonGroup
                className="scope-group-file"
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
          </div>
        ) : null}
      </div>
      <p className="scope-note">
        Pack lists completed calendar months. The GST Portal determines whether a record is available;
        monthly or quarterly context can require review. A no-record result does not mean “never filed.”
      </p>
      {scopeLockedForReview && flowSummary?.currentPeriod ? (
        <p className="scope-note scope-note-warning" role="status">
          A saved run is paused at {flowSummary.currentPeriod}. You can change this selection, then
          resume the saved run or explicitly discard it and start the selected download below.
        </p>
      ) : null}
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

function scopeWithoutCustomRange(
  scope: FiledReturnsDownloadScope,
  period: string,
): FiledReturnsDownloadScope {
  return {
    financialYear: scope.financialYear,
    period,
    returnType: scope.returnType,
    ...(scope.artifactType ? { artifactType: scope.artifactType } : {}),
    ...(scope.completedPeriods ? { completedPeriods: scope.completedPeriods } : {}),
  };
}

export function ScopeFormAction({
  busy,
  context,
  flowSummary,
  localProcessingAcknowledged = true,
  scope,
  onStart,
}: {
  busy: string | null;
  context: PortalContext | null;
  flowSummary?: FiledReturnsFlowSummary | null;
  localProcessingAcknowledged?: boolean;
  scope: FiledReturnsDownloadScope;
  onStart: () => void;
}) {
  const formModel = createScopeFormModel(scope);
  const startAction = getScopeFormStartAction(scope, flowSummary, busy, formModel.fullFiscalYear);
  const actionCopy = getScopeActionCopy(scope, formModel.fullFiscalYear);
  const portalSupported = context?.supported === true;
  const portalIndependentRetry = canRetryFullFiscalYearZipWithoutPortal(flowSummary);
  const portalReady = portalSupported || portalIndependentRetry;
  const disabledReason = !localProcessingAcknowledged
    ? "Acknowledge local processing before starting a live GST download."
    : portalReady
      ? null
      : getPortalDisabledReason(context);

  return (
    <ScopeActionPanel
      actionCopy={actionCopy}
      busy={busy === "start-filed-returns-flow"}
      disabled={startAction.disabled || !portalReady || !localProcessingAcknowledged}
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

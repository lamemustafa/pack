import React from "react";
import type { PortalContext } from "../../core/contracts";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import {
  filedReturnsCapability,
  filedReturnsCapabilityRunNotes,
} from "../../connectors/gst/filed-returns-capabilities";
import { getFiledReturnsFinancialYearOptions } from "../../connectors/gst/filed-returns-scope";
import { ScopeFormAction } from "../popup/components";
import {
  canRetryFullFiscalYearZipWithoutPortal,
  getScopeMatchedFiledReturnsSummary,
} from "../popup/flow-summary";
import { getScopeFormStartAction } from "../popup/scope-form-model";
import { getRecoveryFlowAvailability } from "../popup/recovery-flow-availability";
import {
  panelAllReturnsFullYearPreset,
  panelFullFiscalYearPresets,
  panelGuidedStepForDisplay,
  panelGuidedSteps,
  type PanelAllReturnsFullYearPlan,
  type PanelAllReturnsFullYearPreset,
  type PanelAllReturnsFullYearResumePlan,
  updatePanelGuidedScope,
} from "./panel-guided-scope-model";
import { isFullFiscalYearScope } from "../../connectors/gst/filed-returns-scope";

export function isPackAlphaBuildMode(buildMode: string): boolean {
  return buildMode === "alpha";
}

export function PanelGuidedScope({
  busy,
  context,
  externalBlock,
  allReturnsExternalBlock,
  allReturnsTerminalBlocks,
  allReturnsResumePlan,
  flowSummary,
  portalSignedIn,
  savedRun,
  scope,
  scopeLockedForReview,
  onScopeChange,
  onStart,
  onStartAllReturnsFullYear,
}: {
  busy: string | null;
  context: PortalContext | null;
  externalBlock: { disabled: true; label: string } | null;
  /** The saved all-supported plan blocks other scopes without blocking its own resume. */
  allReturnsExternalBlock?: { disabled: true; label: string } | null;
  /** A terminal saved plan blocks only the root it owns; other recipes stay available. */
  allReturnsTerminalBlocks?: readonly { financialYear: string; label: string }[];
  /** The one saved root plan allowed through its otherwise blocking recovery state. */
  allReturnsResumePlan?: PanelAllReturnsFullYearResumePlan;
  flowSummary: FiledReturnsFlowSummary | null;
  portalSignedIn: boolean;
  savedRun: FiledReturnsFlowSummary | null;
  scope: FiledReturnsDownloadScope;
  scopeLockedForReview: boolean;
  onScopeChange: (scope: FiledReturnsDownloadScope) => void;
  onStart: (scope: FiledReturnsDownloadScope) => void;
  /**
   * The all-returns root is intentionally separate from an atomic scope. Until
   * its background message is wired, omitting this callback keeps the preset
   * out of the panel rather than exposing a control that cannot complete.
   */
  onStartAllReturnsFullYear?: (plan: PanelAllReturnsFullYearPlan) => void;
}) {
  // Keep this expression in the panel module: Vite replaces it during a WXT
  // production build, so the alpha JSX below is removed from packaged output.
  // Deliberately the literal comparison rather than `isPackAlphaBuildMode`, despite the duplication.
  // A direct `import.meta.env.MODE === "alpha"` constant-folds at build time, so the alpha JSX below
  // is dead-code eliminated from a packaged build. Routing it through a function call defeats that:
  // the branch survives, the `data-pack-alpha-surface` marker reaches the bundle, and
  // `verify-extension-package` fails -- which is how this was caught.
  const alphaSurfacesEnabled = import.meta.env.MODE === "alpha";
  const [view, setView] = React.useState<"presets" | "guided">("presets");
  const [activeStep, setActiveStep] = React.useState(0);
  const selectRef = React.useRef<HTMLSelectElement>(null);
  const presetDoorRef = React.useRef<HTMLButtonElement>(null);
  const focusTarget = React.useRef<"preset-door" | "select" | null>(null);
  const steps = panelGuidedSteps(scope).map((candidate) =>
    panelGuidedStepForDisplay(candidate, alphaSurfacesEnabled),
  );
  const step = steps[activeStep] ?? steps[0];
  const recoveryAvailability = getRecoveryFlowAvailability(
    flowSummary,
    alphaSurfacesEnabled,
    scopeLockedForReview,
  );
  const [, refreshPresetSnapshot] = React.useState(0);
  // The panel can stay mounted while a new period becomes eligible. Read the
  // financial year and its period plan from the same render-time snapshot so
  // a focus-driven parent refresh cannot combine a current FY with old periods.
  const presetAsOf = new Date();
  const financialYears = getFiledReturnsFinancialYearOptions(presetAsOf);
  const currentFinancialYear = financialYears[0];
  const presets =
    alphaSurfacesEnabled && currentFinancialYear
      ? panelFullFiscalYearPresets(currentFinancialYear, presetAsOf)
      : [];
  const allReturnsFinancialYears = [
    ...financialYears.slice(0, 2),
    ...(allReturnsResumePlan &&
    !financialYears.slice(0, 2).includes(allReturnsResumePlan.financialYear)
      ? [allReturnsResumePlan.financialYear]
      : []),
  ];
  const allReturnsPresets = alphaSurfacesEnabled
    ? allReturnsFinancialYears.reverse().flatMap((financialYear) => {
        const preset = panelAllReturnsFullYearPreset(financialYear, presetAsOf);
        return preset ? [preset] : [];
      })
    : [];

  React.useEffect(() => {
    // Initial autofocus can scroll a saved-run warning out of a short panel.
    // Request focus only after an action replaces the focused control.
    const requestedTarget = focusTarget.current;
    if (!requestedTarget) return;
    focusTarget.current = null;
    if (requestedTarget === "select") selectRef.current?.focus();
    else presetDoorRef.current?.focus();
  }, [activeStep, view]);

  if (!step) return null;

  const move = (offset: number) => {
    focusTarget.current = "select";
    setActiveStep((current) => Math.max(0, Math.min(steps.length - 1, current + offset)));
  };

  if (view === "presets") {
    return (
      <section className="panel-presets" aria-labelledby="panel-presets-title">
        <h2 id="panel-presets-title">What do you need?</h2>
        <div className="panel-preset-list">
          {onStartAllReturnsFullYear
            ? allReturnsPresets.map((preset) => (
                <AllReturnsPreset
                  key={preset.financialYear}
                  busy={busy}
                  externalBlock={
                    allReturnsResumePlan?.financialYear === preset.financialYear
                      ? null
                      : allReturnsTerminalBlocks?.find(
                            (block) => block.financialYear === preset.financialYear,
                          )
                        ? {
                            disabled: true,
                            label: allReturnsTerminalBlocks.find(
                              (block) => block.financialYear === preset.financialYear,
                            )!.label,
                          }
                        : (allReturnsExternalBlock ?? externalBlock)
                  }
                  primary={preset.financialYear === financialYears[1]}
                  plan={preset}
                  {...(allReturnsResumePlan?.financialYear === preset.financialYear
                    ? { resumePlan: allReturnsResumePlan }
                    : {})}
                  portalReady={portalSignedIn}
                  onStart={onStartAllReturnsFullYear}
                  onStalePlan={() => refreshPresetSnapshot((current) => current + 1)}
                />
              ))
            : null}
          {presets.map((preset) => {
            const savedRunForPreset = getScopeMatchedFiledReturnsSummary(preset.scope, savedRun);
            const summaryForPreset = savedRunForPreset ?? flowSummary;
            const blockForPreset = savedRunForPreset ? null : externalBlock;
            const startAction = getScopeFormStartAction(preset.scope, summaryForPreset, busy, true);
            const disabled =
              !portalSignedIn || blockForPreset?.disabled === true || startAction.disabled;
            const disabledReason =
              blockForPreset?.label ??
              (startAction.disabled
                ? startAction.label
                : portalSignedIn
                  ? null
                  : "Open a signed-in GST Portal tab to continue.");
            return (
              <React.Fragment key={preset.scope.returnType}>
                <button
                  className="panel-preset"
                  type="button"
                  disabled={disabled}
                  aria-describedby={
                    disabledReason ? `preset-${preset.scope.returnType}-reason` : undefined
                  }
                  onClick={() => {
                    const currentAsOf = new Date();
                    const currentFinancialYear =
                      getFiledReturnsFinancialYearOptions(currentAsOf)[0];
                    const currentPreset = currentFinancialYear
                      ? panelFullFiscalYearPresets(currentFinancialYear, currentAsOf).find(
                          (candidate) => candidate.scope.returnType === preset.scope.returnType,
                        )
                      : undefined;
                    if (
                      !currentPreset ||
                      currentPreset.periodCount !== preset.periodCount ||
                      currentPreset.scope.financialYear !== preset.scope.financialYear ||
                      currentPreset.scope.artifactType !== preset.scope.artifactType
                    ) {
                      refreshPresetSnapshot((current) => current + 1);
                      return;
                    }
                    onScopeChange(preset.scope);
                    onStart(preset.scope);
                  }}
                >
                  <span>{preset.label}</span>
                  <span className="panel-preset-count">
                    {preset.periodCount} {preset.periodCount === 1 ? "period" : "periods"} ·{" "}
                    {preset.artifactLabel.toLowerCase()} · one ZIP
                  </span>
                </button>
                {disabledReason ? (
                  <p
                    className="panel-preset-reason"
                    id={`preset-${preset.scope.returnType}-reason`}
                  >
                    {disabledReason}
                  </p>
                ) : null}
                {filedReturnsCapabilityRunNotes(
                  preset.scope.returnType,
                  preset.scope.artifactType ?? "PDF",
                ).map((note) => (
                  <p className="panel-preset-note" key={note}>
                    {note}
                  </p>
                ))}
              </React.Fragment>
            );
          })}
        </div>
        <div className="panel-preset-door-wrap">
          <button
            className="panel-preset panel-preset-door"
            type="button"
            ref={presetDoorRef}
            onClick={() => {
              focusTarget.current = "select";
              setView("guided");
            }}
          >
            <span>Choose return, year and period</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </section>
    );
  }

  const savedRunForScope = getScopeMatchedFiledReturnsSummary(scope, savedRun);
  const scopeSummary = savedRunForScope ?? flowSummary;
  const scopeExternalBlock = savedRunForScope ? null : externalBlock;
  const guidedExternalBlock =
    scopeExternalBlock ??
    (canRetryFullFiscalYearZipWithoutPortal(scopeSummary)
      ? null
      : !alphaSurfacesEnabled && isFullFiscalYearScope(scope)
        ? {
            disabled: true as const,
            label:
              "This full-year flow is available only in a source build qualified for alpha use.",
          }
        : portalSignedIn
          ? null
          : { disabled: true as const, label: "Open a signed-in GST Portal tab to continue." });

  return (
    <section
      className="panel-guide"
      aria-labelledby="panel-guide-title"
      {...(alphaSurfacesEnabled ? { "data-pack-alpha-surface": "full-fiscal-year" } : {})}
    >
      <div
        className="panel-guide-progress"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`Step ${activeStep + 1} of ${steps.length}`}
      >
        <span>
          Step {activeStep + 1} of {steps.length}
        </span>
        <span className="panel-guide-progress-track" aria-hidden="true">
          {steps.map((candidate, index) => (
            <span
              key={candidate.key}
              className={index <= activeStep ? "panel-guide-progress-on" : undefined}
            />
          ))}
        </span>
      </div>
      <h2 id="panel-guide-title">{step.title}</h2>
      <p className="panel-guide-hint" id="panel-guide-hint">
        {step.hint}
      </p>
      <label className="panel-guide-select" htmlFor="panel-guide-field">
        <span>{step.label}</span>
        <select
          key={step.key}
          ref={selectRef}
          id="panel-guide-field"
          value={step.value}
          disabled={busy !== null}
          aria-describedby="panel-guide-hint"
          onChange={(event) =>
            onScopeChange(updatePanelGuidedScope(scope, step.key, event.currentTarget.value))
          }
        >
          {step.options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <ActiveScope scope={scope} />
      <div className="panel-guide-actions">
        <button
          className="panel-guide-back secondary"
          type="button"
          onClick={() => {
            if (activeStep === 0) {
              focusTarget.current = "preset-door";
              setView("presets");
            } else move(-1);
          }}
        >
          {activeStep === 0 ? "Back to presets" : "Back"}
        </button>
        {activeStep < steps.length - 1 ? (
          <button className="panel-guide-next" type="button" onClick={() => move(1)}>
            Continue
          </button>
        ) : (
          <ScopeFormAction
            busy={busy}
            context={context}
            externalBlock={guidedExternalBlock}
            flowSummary={scopeSummary}
            scope={scope}
            onStart={() => onStart(scope)}
          />
        )}
      </div>
      {scopeLockedForReview && flowSummary?.currentPeriod ? (
        <p className="scope-note scope-note-warning" role="status">
          {recoveryAvailability.isWithheldFullYearRecovery
            ? recoveryAvailability.guidance
            : `A saved run is paused at ${flowSummary.currentPeriod}. Resume or discard it before starting another scope.`}
        </p>
      ) : null}
    </section>
  );
}

function AllReturnsPreset({
  busy,
  externalBlock,
  primary,
  plan,
  portalReady,
  resumePlan,
  onStart,
  onStalePlan,
}: {
  busy: string | null;
  externalBlock: { disabled: true; label: string } | null;
  primary: boolean;
  plan: PanelAllReturnsFullYearPreset;
  portalReady: boolean;
  resumePlan?: PanelAllReturnsFullYearResumePlan;
  onStart: (plan: PanelAllReturnsFullYearPlan) => void;
  onStalePlan: () => void;
}) {
  const disabled = !portalReady || busy !== null || externalBlock?.disabled === true;
  const disabledReason =
    externalBlock?.label ??
    (busy !== null
      ? "Pack is processing another action."
      : portalReady
        ? null
        : "Open a signed-in GST Portal tab to continue.");
  const displayedPlan = resumePlan
    ? {
        ...plan,
        ...resumePlan,
        note: `Saved plan · ${resumePlan.periodCount} eligible ${plural(resumePlan.periodCount, "period")} retained.`,
      }
    : plan;
  const countLabel = `${displayedPlan.returnCount} ${plural(displayedPlan.returnCount, "return")} · ${displayedPlan.periodCount} ${plural(displayedPlan.periodCount, "period")} each · up to ${displayedPlan.fileCount} ${plural(displayedPlan.fileCount, "file")} · ZIP when files are available`;
  const disabledReasonId = `preset-all-returns-${plan.financialYear}-reason`;

  return (
    <React.Fragment>
      <button
        className={`panel-preset panel-everything-preset${primary ? " panel-everything-preset-primary" : ""}`}
        type="button"
        disabled={disabled}
        aria-describedby={disabledReason ? disabledReasonId : undefined}
        aria-label={`${displayedPlan.label} for all supported returns. ${countLabel}. ${displayedPlan.note}`}
        onClick={() => {
          if (resumePlan) {
            const currentPlan = panelAllReturnsFullYearPreset(plan.financialYear, new Date());
            if (!currentPlan || currentPlan.label !== plan.label) {
              onStalePlan();
              return;
            }
            onStart({ kind: plan.kind, financialYear: plan.financialYear });
            return;
          }
          const currentAsOf = new Date();
          const currentPlan = panelAllReturnsFullYearPreset(plan.financialYear, currentAsOf);
          if (
            !currentPlan ||
            currentPlan.financialYear !== plan.financialYear ||
            currentPlan.label !== plan.label ||
            currentPlan.note !== plan.note ||
            currentPlan.returnCount !== plan.returnCount ||
            currentPlan.periodCount !== plan.periodCount ||
            currentPlan.artifactCount !== plan.artifactCount ||
            currentPlan.fileCount !== plan.fileCount
          ) {
            onStalePlan();
            return;
          }
          onStart({ kind: plan.kind, financialYear: plan.financialYear });
        }}
      >
        <span>{displayedPlan.label} · all supported returns</span>
        <span className="panel-preset-count">{countLabel}</span>
      </button>
      {disabledReason ? (
        <p className="panel-preset-reason" id={disabledReasonId}>
          {disabledReason}
        </p>
      ) : null}
      <p className="panel-preset-note">{displayedPlan.note}</p>
    </React.Fragment>
  );
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function ActiveScope({ scope }: { scope: FiledReturnsDownloadScope }) {
  const capability = filedReturnsCapability(scope.returnType);
  const steps = panelGuidedSteps(scope);
  const period = steps[2]?.options.find((option) => option.value === scope.period)?.label;
  const artifact = steps[3]?.options.find((option) => option.value === steps[3]?.value)?.label;
  return (
    <div className="panel-guide-scope" aria-label="One active scope">
      <h3>Review target</h3>
      <dl>
        <div>
          <dt>Return</dt>
          <dd>{capability.label}</dd>
        </div>
        <div>
          <dt>FY</dt>
          <dd>{scope.financialYear}</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd>{period ?? scope.period}</dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>{artifact ?? scope.artifactType ?? "PDF"}</dd>
        </div>
      </dl>
    </div>
  );
}

import React from "react";
import type { PortalContext } from "../../core/contracts";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import {
  filedReturnsCapability,
  filedReturnsCapabilityArtifactDescription,
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
  discardAllReturnsPlanLabel,
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

export function isPackSourceSurfaceBuildMode(buildMode: string): boolean {
  return buildMode === "source-surfaces";
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
  onRestartAllReturnsFullYear,
}: {
  busy: string | null;
  context: PortalContext | null;
  externalBlock: { disabled: true; label: string } | null;
  /** The saved all-supported plan blocks other scopes without blocking its own resume. */
  allReturnsExternalBlock?: { disabled: true; label: string } | null;
  /** A terminal saved plan blocks only the root it owns; other recipes stay available. */
  allReturnsTerminalBlocks?: readonly {
    /** The ledger this root projects; every destructive restart must name it. */
    ledgerId?: string;
    financialYear: string;
    label: string;
    restartPlan?: true;
  }[];
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
  /** Explicitly discards a completed root before starting that exact plan again. */
  onRestartAllReturnsFullYear?: (plan: PanelAllReturnsFullYearPlan & { ledgerId?: string }) => void;
}) {
  // Keep this expression in the panel module: Vite replaces it during a WXT
  // production build, so the source-surface JSX below is removed from packaged output.
  // Deliberately the literal comparison rather than `isPackSourceSurfaceBuildMode`, despite the duplication.
  // A direct `import.meta.env.MODE === "source-surfaces"` constant-folds at build time, so the source-surface JSX below
  // is dead-code eliminated from a packaged build. Routing it through a function call defeats that:
  // the branch survives, the `data-pack-source-surface` marker reaches the bundle, and
  // `verify-extension-package` fails -- which is how this was caught.
  const sourceSurfacesEnabled = import.meta.env.MODE === "source-surfaces";
  const [view, setView] = React.useState<"presets" | "guided">("presets");
  const [activeStep, setActiveStep] = React.useState(0);
  const selectRef = React.useRef<HTMLSelectElement>(null);
  const presetDoorRef = React.useRef<HTMLButtonElement>(null);
  const focusTarget = React.useRef<"preset-door" | "select" | null>(null);
  const steps = panelGuidedSteps(scope).map((candidate) =>
    panelGuidedStepForDisplay(candidate, sourceSurfacesEnabled),
  );
  const step = steps[activeStep] ?? steps[0];
  const recoveryAvailability = getRecoveryFlowAvailability(
    flowSummary,
    sourceSurfacesEnabled,
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
    sourceSurfacesEnabled && currentFinancialYear
      ? panelFullFiscalYearPresets(currentFinancialYear, presetAsOf)
      : [];
  const allReturnsFinancialYears = [
    ...financialYears.slice(0, 2),
    ...(allReturnsResumePlan &&
    !financialYears.slice(0, 2).includes(allReturnsResumePlan.financialYear)
      ? [allReturnsResumePlan.financialYear]
      : []),
  ];
  const allReturnsPresets = sourceSurfacesEnabled
    ? allReturnsFinancialYears.reverse().flatMap((financialYear) => {
        const preset = panelAllReturnsFullYearPreset(financialYear, presetAsOf);
        return preset ? [preset] : [];
      })
    : [];
  const allReturnsPresetEntries = allReturnsPresets.map((preset) => {
    const terminalBlock = allReturnsTerminalBlocks?.find(
      (block) => block.financialYear === preset.financialYear,
    );
    return {
      preset,
      terminalBlock,
      externalBlock:
        allReturnsResumePlan?.financialYear === preset.financialYear || terminalBlock?.restartPlan
          ? null
          : terminalBlock
            ? { disabled: true as const, label: terminalBlock.label }
            : (allReturnsExternalBlock ?? externalBlock),
    };
  });
  const presetBlocks = presets.map((preset) =>
    getScopeMatchedFiledReturnsSummary(preset.scope, savedRun) ? null : externalBlock,
  );
  const renderedPresetBlocks = [
    ...presetBlocks,
    ...(onStartAllReturnsFullYear
      ? allReturnsPresetEntries.map((entry) => entry.externalBlock)
      : []),
  ];
  // A saved-plan block is one explanation for every option, not a paragraph
  // that happens to appear beside every option. Preserve per-preset reasons
  // whenever any option has a different block or no block at all.
  const firstRenderedPresetBlock = renderedPresetBlocks[0];
  const sharedExternalBlock =
    firstRenderedPresetBlock !== null &&
    firstRenderedPresetBlock !== undefined &&
    renderedPresetBlocks.every((block) => block === firstRenderedPresetBlock)
      ? firstRenderedPresetBlock
      : null;
  const sharedExternalBlockId = "panel-presets-shared-reason";

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
        {sharedExternalBlock ? (
          <p className="panel-preset-reason" id={sharedExternalBlockId}>
            {sharedExternalBlock.label}
          </p>
        ) : null}
        <div className="panel-preset-list">
          {onStartAllReturnsFullYear && allReturnsPresetEntries.length > 0 ? (
            <div className="panel-everything-preset-group">
              {allReturnsPresetEntries.map(
                ({ preset, terminalBlock, externalBlock: presetBlock }) => (
                  <AllReturnsPreset
                    key={preset.financialYear}
                    busy={busy}
                    externalBlock={presetBlock}
                    {...(presetBlock === sharedExternalBlock
                      ? { sharedDisabledReasonId: sharedExternalBlockId }
                      : {})}
                    primary={preset.financialYear === financialYears[1]}
                    plan={preset}
                    {...(allReturnsResumePlan?.financialYear === preset.financialYear
                      ? { resumePlan: allReturnsResumePlan }
                      : {})}
                    {...(terminalBlock?.restartPlan && onRestartAllReturnsFullYear
                      ? {
                          onRestart: (plan: PanelAllReturnsFullYearPlan) =>
                            onRestartAllReturnsFullYear(
                              terminalBlock.ledgerId === undefined
                                ? plan
                                : { ...plan, ledgerId: terminalBlock.ledgerId },
                            ),
                        }
                      : {})}
                    portalReady={portalSignedIn}
                    onStart={onStartAllReturnsFullYear}
                    onStalePlan={() => refreshPresetSnapshot((current) => current + 1)}
                  />
                ),
              )}
            </div>
          ) : null}
          {presets.map((preset, index) => {
            const artifactDescription = preset.scope.artifactType
              ? filedReturnsCapabilityArtifactDescription(
                  preset.scope.returnType,
                  preset.scope.artifactType,
                )
              : "selected portal files";
            const savedRunForPreset = getScopeMatchedFiledReturnsSummary(preset.scope, savedRun);
            const summaryForPreset = savedRunForPreset ?? flowSummary;
            const blockForPreset = presetBlocks[index] ?? null;
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
                  aria-label={`${preset.label}. Downloads ${artifactDescription}.`}
                  aria-describedby={
                    disabledReason
                      ? blockForPreset === sharedExternalBlock
                        ? sharedExternalBlockId
                        : `preset-${preset.scope.returnType}-reason`
                      : undefined
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
                </button>
                {disabledReason && blockForPreset !== sharedExternalBlock ? (
                  <p
                    className="panel-preset-reason"
                    id={`preset-${preset.scope.returnType}-reason`}
                  >
                    {disabledReason}
                  </p>
                ) : null}
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
      : !sourceSurfacesEnabled && isFullFiscalYearScope(scope)
        ? {
            disabled: true as const,
            // Addressed to a taxpayer, not to a contributor. Naming the build
            // mode here -- "alpha" before the rename, "source-surfaces" after
            // -- tells the reader nothing they can act on, and is exactly the
            // internal vocabulary the mode rename was meant to stop leaking.
            label: "This full-year flow is not available in the published build of Pack.",
          }
        : portalSignedIn
          ? null
          : { disabled: true as const, label: "Open a signed-in GST Portal tab to continue." });

  return (
    <section
      className="panel-guide"
      aria-labelledby="panel-guide-title"
      {...(sourceSurfacesEnabled ? { "data-pack-source-surface": "full-fiscal-year" } : {})}
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
  sharedDisabledReasonId,
  onRestart,
  onStart,
  onStalePlan,
}: {
  busy: string | null;
  externalBlock: { disabled: true; label: string } | null;
  primary: boolean;
  plan: PanelAllReturnsFullYearPreset;
  portalReady: boolean;
  resumePlan?: PanelAllReturnsFullYearResumePlan;
  sharedDisabledReasonId?: string;
  onRestart?: (plan: PanelAllReturnsFullYearPlan) => void;
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
  const restartable = onRestart !== undefined;
  const coverageLabel = displayedPlan.returnTypes.map(shortReturnLabel).join(" · ");
  const disabledReasonId = `preset-all-returns-${plan.financialYear}-reason`;
  const restartLabel = discardAllReturnsPlanLabel(
    displayedPlan.financialYear,
    `run ${displayedPlan.label.toLowerCase()}`,
  );

  return (
    <React.Fragment>
      <button
        className={`panel-preset panel-everything-preset${primary ? " panel-everything-preset-primary" : ""}`}
        type="button"
        disabled={disabled}
        aria-describedby={disabledReason ? (sharedDisabledReasonId ?? disabledReasonId) : undefined}
        aria-label={`${restartable ? restartLabel : displayedPlan.label}. ${coverageLabel}.`}
        onClick={() => {
          if (onRestart) {
            // Restart discards a completed plan and starts a new one. A panel
            // left open across a month or fiscal-year boundary renders from an
            // older snapshot, so dispatching the captured plan would silently
            // start a run over periods the reader never saw -- after the
            // completed history has already been removed. Same comparison the
            // ordinary start uses; the destructive branch needs it more, not
            // less.
            if (planMatchesToday(plan)) {
              onRestart({ kind: plan.kind, financialYear: plan.financialYear });
            } else {
              onStalePlan();
            }
            return;
          }
          if (resumePlan) {
            const currentPlan = panelAllReturnsFullYearPreset(plan.financialYear, new Date());
            if (!currentPlan || currentPlan.label !== plan.label) {
              onStalePlan();
              return;
            }
            onStart({ kind: plan.kind, financialYear: plan.financialYear });
            return;
          }
          if (!planMatchesToday(plan)) {
            onStalePlan();
            return;
          }
          onStart({ kind: plan.kind, financialYear: plan.financialYear });
        }}
      >
        <span>{restartable ? restartLabel : displayedPlan.label}</span>
        <span className="panel-everything-preset-coverage">{coverageLabel}</span>
      </button>
      {disabledReason && !sharedDisabledReasonId ? (
        <p className="panel-preset-reason" id={disabledReasonId}>
          {disabledReason}
        </p>
      ) : null}
    </React.Fragment>
  );
}

/**
 * Whether a rendered plan still describes what a run started now would fetch.
 * Derived from the same builder the action dispatches against, so a panel left
 * open across a period boundary cannot start work the reader never saw.
 */
function planMatchesToday(plan: PanelAllReturnsFullYearPreset): boolean {
  const currentPlan = panelAllReturnsFullYearPreset(plan.financialYear, new Date());
  return (
    currentPlan !== null &&
    currentPlan.financialYear === plan.financialYear &&
    currentPlan.label === plan.label &&
    currentPlan.note === plan.note &&
    currentPlan.returnCount === plan.returnCount &&
    currentPlan.periodCount === plan.periodCount &&
    currentPlan.artifactCount === plan.artifactCount &&
    currentPlan.fileCount === plan.fileCount
  );
}

function shortReturnLabel(returnType: string): string {
  return returnType === "GSTR-1" ? "R1" : returnType.replace("GSTR-", "");
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

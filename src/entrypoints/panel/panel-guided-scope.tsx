import React from "react";
import type { PortalContext } from "../../core/contracts";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import {
  filedReturnsCapability,
  filedReturnsCatalogueEntries,
  type FiledReturnsCatalogueEntry,
} from "../../connectors/gst/filed-returns-capabilities";
import { ScopeFormAction } from "../popup/components";
import { panelGuidedSteps, updatePanelGuidedScope } from "./panel-guided-scope-model";

export function PanelGuidedScope({
  busy,
  context,
  externalBlock,
  flowSummary,
  scope,
  scopeLockedForReview,
  onScopeChange,
  onStart,
}: {
  busy: string | null;
  context: PortalContext | null;
  externalBlock: { disabled: true; label: string } | null;
  flowSummary: FiledReturnsFlowSummary | null;
  scope: FiledReturnsDownloadScope;
  scopeLockedForReview: boolean;
  onScopeChange: (scope: FiledReturnsDownloadScope) => void;
  onStart: () => void;
}) {
  const [activeStep, setActiveStep] = React.useState(0);
  const selectRef = React.useRef<HTMLSelectElement>(null);
  const focusRequested = React.useRef(false);
  const steps = panelGuidedSteps(scope);
  const step = steps[activeStep] ?? steps[0];

  React.useEffect(() => {
    // Initial autofocus can scroll a saved-run warning out of a short panel.
    if (!focusRequested.current) return;
    focusRequested.current = false;
    selectRef.current?.focus();
  }, [activeStep]);

  if (!step) return null;

  const move = (offset: number) => {
    focusRequested.current = true;
    setActiveStep((current) => Math.max(0, Math.min(steps.length - 1, current + offset)));
  };

  return (
    <section className="panel-guide" aria-labelledby="panel-guide-title">
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
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <ActiveScope scope={scope} />
      <div className="panel-guide-actions">
        {activeStep > 0 ? (
          <button className="panel-guide-back secondary" type="button" onClick={() => move(-1)}>
            Back
          </button>
        ) : null}
        {activeStep < steps.length - 1 ? (
          <button className="panel-guide-next" type="button" onClick={() => move(1)}>
            Continue
          </button>
        ) : (
          <ScopeFormAction
            busy={busy}
            context={context}
            externalBlock={externalBlock}
            flowSummary={flowSummary}
            scope={scope}
            onStart={onStart}
          />
        )}
      </div>
      {scopeLockedForReview && flowSummary?.currentPeriod ? (
        <p className="scope-note scope-note-warning" role="status">
          A saved run is paused at {flowSummary.currentPeriod}. Resume or discard it before starting
          another scope.
        </p>
      ) : null}
      <CatalogueLimits />
    </section>
  );
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

function CatalogueLimits() {
  const entries = filedReturnsCatalogueEntries();
  const available = entries.filter((entry) => entry.capability.supportStatus === "supported");
  const unavailable = entries.filter((entry) => entry.capability.supportStatus === "unsupported");
  return (
    <details className="panel-catalogue">
      <summary>
        Catalogue &amp; limits
        <span>
          {available.length} available · {unavailable.length} unavailable
        </span>
      </summary>
      <p>Available rows show selectable files. Other rows are reference only.</p>
      <CatalogueGroup heading="Available" entries={available} />
      <CatalogueGroup
        className="panel-catalogue-unavailable"
        heading="Not available in Pack"
        entries={unavailable}
      />
    </details>
  );
}

function CatalogueGroup({
  className,
  entries,
  heading,
}: {
  className?: string;
  entries: FiledReturnsCatalogueEntry[];
  heading: string;
}) {
  return (
    <section className={className}>
      <h3>
        {heading} <span>{entries.length}</span>
      </h3>
      <ul>
        {entries.map(({ returnType, capability }) => {
          const artifactLabels = Object.values(capability.artifacts).map(
            (artifact) => artifact.label,
          );
          return (
            <li key={returnType}>
              <span>{capability.label}</span>
              <span>
                {sentenceCase(capability.periodicity)}
                {capability.supportStatus === "supported"
                  ? ` · ${artifactLabels.join(" · ")}`
                  : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function sentenceCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

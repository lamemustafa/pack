import type { FiledReturnsDownloadScope, PortalContext } from "../../core/contracts";
import {
  filedReturnsArtifactLabel,
  normaliseFiledReturnsArtifactType,
} from "../../core/filed-returns-artifacts";
import { isFullFiscalYearScope } from "../../core/filed-returns-scope";

export function DownloadTargetSummary({
  completionStatus,
  context,
  scope,
  status,
}: {
  completionStatus: string | null;
  context: PortalContext | null;
  scope: FiledReturnsDownloadScope;
  status: string;
}) {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const fullFiscalYear = isFullFiscalYearScope(scope);
  const portalState = context?.supported ? "Portal ready" : "Portal needed";
  const stateClassName = context?.supported
    ? "state-pill state-pill-ready"
    : "state-pill state-pill-needed";
  const runSteps = targetRunSteps(scope.returnType, fullFiscalYear);

  return (
    <section className="target-strip" aria-label="Selected filed return download target">
      <div className="target-strip-header">
        <div>
          <p className="section-label">Ready to run</p>
          <h2>{scope.returnType} local download</h2>
        </div>
        <span className={stateClassName}>{portalState}</span>
      </div>
      <dl className="target-metadata">
        <div>
          <dt>Financial year</dt>
          <dd>{scope.financialYear}</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd>{fullFiscalYear ? "Full year" : scope.period}</dd>
        </div>
        <div>
          <dt>Artifact</dt>
          <dd>{filedReturnsArtifactLabel(artifactType, scope.returnType)}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{fullFiscalYear ? "ZIP handoff" : "Single period"}</dd>
        </div>
      </dl>
      <ol className="target-run-steps" aria-label="Run sequence">
        {runSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="target-status">
        {currentTargetStatus({
          completionStatus,
          context,
          status,
        })}
      </p>
    </section>
  );
}

function targetRunSteps(
  returnType: FiledReturnsDownloadScope["returnType"],
  fullFiscalYear: boolean,
): string[] {
  if (returnType === "GSTR-2B") {
    return fullFiscalYear
      ? ["Open each period", "Capture portal files", "Save one ZIP"]
      : ["Use visible page", "Capture portal files", "Save local ZIP"];
  }
  if (fullFiscalYear) return ["Open each period", "Confirm filed page", "Save one ZIP"];
  return ["Use visible page", "Confirm target", "Save locally"];
}

function currentTargetStatus({
  completionStatus,
  context,
  status,
}: {
  completionStatus: string | null;
  context: PortalContext | null;
  status: string;
}): string {
  if (!context?.supported) return "Waiting for a supported GST Portal tab.";
  return completionStatus ?? status;
}

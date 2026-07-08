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
  const portalState = context?.supported ? "Portal ready" : "Portal needed";

  return (
    <section className="target-strip" aria-label="Selected filed return download target">
      <div className="target-strip-header">
        <div>
          <p className="section-label">Selected target</p>
          <h2>{scope.returnType} local download</h2>
        </div>
        <span className={context?.supported ? "state-pill state-pill-ready" : "state-pill"}>
          {portalState}
        </span>
      </div>
      <dl className="target-metadata">
        <div>
          <dt>Financial year</dt>
          <dd>{scope.financialYear}</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd>{isFullFiscalYearScope(scope) ? "Full year" : scope.period}</dd>
        </div>
        <div>
          <dt>Artifact</dt>
          <dd>{filedReturnsArtifactLabel(artifactType, scope.returnType)}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{isFullFiscalYearScope(scope) ? "ZIP handoff" : "Single period"}</dd>
        </div>
      </dl>
      <p className="target-status">{completionStatus ?? status}</p>
    </section>
  );
}

import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../../core/contracts";
import {
  filedReturnsArtifactLabel,
  normaliseFiledReturnsArtifactType,
} from "../../core/filed-returns-artifacts";
import {
  getFiledReturnsPeriodOptions,
  isFullFiscalYearScope,
} from "../../core/filed-returns-scope";

export function PackSummary({
  scope,
  summary,
}: {
  scope: FiledReturnsDownloadScope;
  summary: FiledReturnsFlowSummary | null;
}) {
  const fullYear = isFullFiscalYearScope(scope);
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const totalPeriods =
    summary?.totalPeriods ?? getFiledReturnsPeriodOptions(scope.financialYear).length;
  const completedPeriods = summary?.completedPeriods.length ?? 0;
  const needsReview =
    summary && summary.status !== "complete" ? Math.max(totalPeriods - completedPeriods, 0) : 0;
  const fileLabel = filedReturnsArtifactLabel(artifactType, scope.returnType);

  return (
    <section className="pack-summary" aria-label="Your pack">
      <div className="pack-summary-heading">
        <div>
          <p className="section-label">Your pack</p>
          <h2>
            {scope.returnType} · FY {scope.financialYear.replace("-", "–")}
          </h2>
        </div>
        <div className="pack-motif" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
      <p className="pack-summary-line">
        {fullYear ? `${totalPeriods} periods` : `${scope.period} period`} · {fileLabel}
      </p>
      <p className="pack-summary-meta">
        {fullYear ? "One ZIP · saved by your browser" : "Saved by your browser"}
        {needsReview > 0 ? ` · ${completedPeriods} ready · ${needsReview} needs review` : null}
      </p>
    </section>
  );
}

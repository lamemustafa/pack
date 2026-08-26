import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import {
  filedReturnsArtifactLabel,
  normaliseFiledReturnsArtifactType,
} from "../../connectors/gst/filed-returns-artifacts";
import {
  getFiledReturnsPeriodOptions,
  isFullFiscalYearScope,
} from "../../connectors/gst/filed-returns-scope";
import {
  hasPersistedFullFiscalYearZipDownloadId,
  isAmbiguousFullFiscalYearZipHandoff,
} from "./flow-summary";

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
  const fileLabel = filedReturnsArtifactLabel(artifactType, scope.returnType);
  const fullYearMeta = getFullYearMeta(summary);
  const singlePeriodMeta = getSinglePeriodMeta(summary);

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
      <p className="pack-summary-meta">{fullYear ? fullYearMeta : singlePeriodMeta}</p>
    </section>
  );
}

function getSinglePeriodMeta(summary: FiledReturnsFlowSummary | null): string {
  const signals = new Set(summary?.flowStep.safeSignals ?? []);
  if (
    signals.has("single-period-zip-downloaded") ||
    (signals.has("browser-download-completed") && signals.has("browser-download-non-empty"))
  ) {
    return "Saved by your browser";
  }
  if (signals.has("filed-return-positively-not-filed")) return "No browser download needed";
  if (summary?.status === "running") return "Filed-returns run in progress";
  if (summary && summary.status !== "cancelled") return "Browser download not confirmed";
  return "Local browser download";
}

function getFullYearMeta(summary: FiledReturnsFlowSummary | null): string {
  const signals = new Set(summary?.flowStep.safeSignals ?? []);
  if (hasPersistedFullFiscalYearZipDownloadId(summary)) {
    return "Final ZIP started · browser status not yet confirmed";
  }
  if (isAmbiguousFullFiscalYearZipHandoff(summary)) {
    return "Final ZIP may already have started · check Browser Downloads";
  }
  if (signals.has("full-fiscal-year-zip-downloaded")) {
    if (signals.has("full-fiscal-year-summary-outcomes-only")) {
      return "One ZIP · outcome-only summary · saved by your browser";
    }
    if (signals.has("full-fiscal-year-summary-included")) {
      const parsedPeriodCount = fixedCountSignal(
        summary,
        "full-fiscal-year-summary-parsed-period-count:",
      );
      return parsedPeriodCount === null
        ? "One ZIP · summary included · saved by your browser"
        : `One ZIP · summary for ${parsedPeriodCount} ${parsedPeriodCount === 1 ? "period" : "periods"} · saved by your browser`;
    }
    if (signals.has("full-fiscal-year-summary-failed")) {
      return "One ZIP · summary unavailable · saved by your browser";
    }
    return "One ZIP · saved by your browser";
  }
  if (signals.has("full-fiscal-year-no-zip-artifacts")) {
    return "No ZIP created · no eligible files";
  }
  if (summary?.status === "running") return "Filed-returns run in progress";
  if (summary && summary.status !== "cancelled") {
    return "One ZIP · browser download not confirmed";
  }
  return "One ZIP · local browser download";
}

function fixedCountSignal(summary: FiledReturnsFlowSummary | null, prefix: string): number | null {
  const signal = summary?.flowStep.safeSignals.find((candidate) => candidate.startsWith(prefix));
  const value = Number(signal?.slice(prefix.length));
  return Number.isInteger(value) && value >= 0 && value <= 36 ? value : null;
}

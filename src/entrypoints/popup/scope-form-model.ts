import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import {
  FILED_RETURNS_ARTIFACT_TYPES,
  concreteFiledReturnsArtifactTypes,
  normaliseFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "../../connectors/gst/filed-returns-artifacts";
import {
  FILED_RETURNS_MONTHS,
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsPeriodOptions,
  getFiledReturnsScopePeriodOptions,
  FULL_FISCAL_YEAR_PERIOD,
  isFullFiscalYearScope,
} from "../../connectors/gst/filed-returns-scope";
import { FILED_RETURNS_RETURN_TYPES } from "../../connectors/gst/filed-returns-return-types";
import {
  filedReturnsCapabilityArtifactDescription,
  filedReturnsCapabilityArtifactLabel,
  filedReturnsCapabilityRunNotes,
  filedReturnsCapabilitySentenceSubject,
  filedReturnsCapabilitySummary,
} from "../../connectors/gst/filed-returns-capabilities";
import {
  canRetryFullFiscalYearZipWithoutPortal,
  hasPersistedFullFiscalYearZipDownloadId,
  isAmbiguousFullFiscalYearZipHandoff,
} from "./flow-summary";

export function createScopeFormModel(scope: FiledReturnsDownloadScope) {
  const singlePeriodOptions = getFiledReturnsPeriodOptions(scope.financialYear, new Date());
  const scopePeriodOptions = getFiledReturnsScopePeriodOptions(
    scope.financialYear,
    new Date(),
    scope.returnType,
  );
  const fullFiscalYear = isFullFiscalYearScope(scope);
  return {
    artifactOptions: FILED_RETURNS_ARTIFACT_TYPES.filter((artifactType) =>
      supportsFiledReturnsArtifactType(scope.returnType, artifactType),
    ).map((artifactType) => ({
      value: artifactType,
      label: artifactOptionLabel(scope.returnType, artifactType),
      description: artifactOptionDescription(scope.returnType, artifactType),
    })),
    financialYearOptions: getFiledReturnsFinancialYearOptions().map((financialYear) => ({
      value: financialYear,
      label: financialYear,
    })),
    fullFiscalYear,
    selectedArtifactType: normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
    singlePeriodOptions,
    supportsFullFiscalYear: scopePeriodOptions.some(
      (option) => option.value === FULL_FISCAL_YEAR_PERIOD,
    ),
  };
}

export function returnTypeOptions() {
  return FILED_RETURNS_RETURN_TYPES.map((returnType) => ({
    value: returnType,
    label: returnType,
    description: filedReturnsCapabilitySummary(returnType),
  }));
}

export function getSinglePeriodFallback(
  period: FiledReturnsDownloadScope["period"],
  options: Array<{ value: string; label: string }>,
): string {
  if (period !== FULL_FISCAL_YEAR_PERIOD) return period;
  return options[0]?.value ?? FILED_RETURNS_MONTHS[0];
}

export function getScopeActionCopy(
  scope: FiledReturnsDownloadScope,
  fullFiscalYear: boolean,
): { summary: string; details: string[] } {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const multiFile = concreteFiledReturnsArtifactTypes(artifactType).length > 1;
  if (!fullFiscalYear) {
    if (multiFile) {
      return {
        summary: `Collect the selected ${scope.returnType} formats into one local ZIP.`,
        details: [
          `Stages ${filedReturnsCapabilityArtifactDescription(scope.returnType, artifactType)} as ZIP entries`,
          "One target-bound browser ZIP handoff",
          "No portal data leaves the device",
        ],
      };
    }
    return {
      summary: "Download one period from the active GST tab.",
      details: ["Target-bound click", "Local browser download", "No portal data leaves the device"],
    };
  }
  return {
    summary:
      "Keep GST Portal visible in the foreground while Pack creates one ZIP for all eligible periods.",
    details: [
      "Walks eligible periods",
      "Stages files locally",
      "Hands off one ZIP",
      ...filedReturnsCapabilityRunNotes(scope.returnType),
    ],
  };
}

export function getScopeFormStartAction(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null | undefined,
  busy: string | null,
  fullFiscalYear: boolean,
): { disabled: boolean; label: string } {
  if (busy === "start-filed-returns-flow") return { disabled: true, label: "Downloading..." };
  if (busy !== null) return { disabled: true, label: defaultStartLabel(scope, fullFiscalYear) };
  if (
    summary &&
    canRetryFullFiscalYearZipWithoutPortal(summary) &&
    isSameScope(scope, summary.scope)
  ) {
    return {
      disabled: false,
      label: hasPersistedFullFiscalYearZipDownloadId(summary)
        ? "Check final ZIP status"
        : isAmbiguousFullFiscalYearZipHandoff(summary)
          ? "I checked—retry final ZIP"
          : "Retry final ZIP",
    };
  }
  if (summary && isSameScope(scope, summary.scope)) {
    const signals = new Set(summary.flowStep.safeSignals);
    if (signals.has("filed-returns-run-active") || signals.has("full-fiscal-year-run-active")) {
      return { disabled: true, label: "Run in progress" };
    }
    if (signals.has("filed-returns-run-needs-review")) {
      return { disabled: true, label: "Reset interrupted run" };
    }
    if (
      signals.has("filed-returns-target-review-required") ||
      signals.has("full-fiscal-year-download-unconfirmed") ||
      signals.has("full-fiscal-year-run-interrupted") ||
      (signals.has("full-fiscal-year-run-needs-action") && !signals.has("gst-portal-tab-required"))
    ) {
      return { disabled: true, label: "Retry after checking GST Portal" };
    }
    if (signals.has("full-fiscal-year-resume-confirmation-required")) {
      return { disabled: true, label: "Resume or discard saved run" };
    }
  }
  return { disabled: false, label: defaultStartLabel(scope, fullFiscalYear) };
}

function defaultStartLabel(scope: FiledReturnsDownloadScope, fullFiscalYear: boolean): string {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const subject = filedReturnsCapabilitySentenceSubject(
    scope.returnType,
    artifactType,
    fullFiscalYear,
  );
  if (fullFiscalYear) return `Download all ${scope.financialYear} ${subject}`;
  return `Download ${scope.period} ${scope.financialYear} ${subject}`;
}

function artifactOptionDescription(
  returnType: FiledReturnsDownloadScope["returnType"],
  artifactType: (typeof FILED_RETURNS_ARTIFACT_TYPES)[number],
): string {
  return filedReturnsCapabilityArtifactDescription(returnType, artifactType);
}

function artifactOptionLabel(
  returnType: FiledReturnsDownloadScope["returnType"],
  artifactType: (typeof FILED_RETURNS_ARTIFACT_TYPES)[number],
): string {
  return filedReturnsCapabilityArtifactLabel(returnType, artifactType);
}

function isSameScope(left: FiledReturnsDownloadScope, right: FiledReturnsDownloadScope): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType) ===
      normaliseFiledReturnsArtifactType(right.returnType, right.artifactType)
  );
}

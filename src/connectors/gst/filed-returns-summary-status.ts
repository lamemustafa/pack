import type { PackOffscreenFiledReturnSummaryResult } from "./offscreen-blob-url";

// Synthesized locally when the offscreen worker's response fails validation,
// so it is not one of the worker's own reason categories.
export const FILED_RETURNS_SUMMARY_RESPONSE_INVALID_CATEGORY = "response-invalid";

export interface FiledReturnsSummaryStatus {
  safeSignals: string[];
}

export type FiledReturnsSummaryLifecycle = "confirmed" | "intent" | "unconfirmed";

export function filedReturnsSummaryOutcome(
  requested: boolean,
  result: PackOffscreenFiledReturnSummaryResult | undefined,
): FiledReturnsSummaryStatus {
  if (!requested) return { safeSignals: [] };
  if (!result) {
    return {
      safeSignals: [
        "full-fiscal-year-summary-failed",
        `full-fiscal-year-summary-error:${FILED_RETURNS_SUMMARY_RESPONSE_INVALID_CATEGORY}`,
      ],
    };
  }
  if (result.status === "failed") {
    return {
      safeSignals: [
        "full-fiscal-year-summary-failed",
        `full-fiscal-year-summary-error:${result.reasonCategory}`,
      ],
    };
  }
  return {
    safeSignals: [
      "full-fiscal-year-summary-included",
      ...(result.workbookOutcome === "not-applicable"
        ? ["full-fiscal-year-workbook-not-applicable"]
        : []),
      ...(result.outcomeOnly ? ["full-fiscal-year-summary-outcomes-only"] : []),
      `full-fiscal-year-summary-parsed-period-count:${result.parsedPeriodCount}`,
      `full-fiscal-year-summary-row-count:${result.rowCount}`,
    ],
  };
}

/**
 * How a success claim may be phrased for a given lifecycle. The failure branch
 * already conditions its wording; the success branches did not, so an
 * unconfirmed download produced "the download may not have completed" followed
 * by "The ZIP includes the workbook and tidy CSV" -- a claim that files were
 * saved when no ZIP may exist.
 *
 * One place decides this, so a fourth success branch cannot reintroduce the
 * contradiction by forgetting to.
 */
function summaryInclusionClaim(lifecycle: FiledReturnsSummaryLifecycle, contents: string): string {
  if (lifecycle === "intent") return `Pack prepared the artifact ZIP with ${contents}.`;
  if (lifecycle === "unconfirmed") return `If the ZIP download completed, it includes ${contents}.`;
  return `The ZIP includes ${contents}.`;
}

export function filedReturnsSummaryStatusMessage(
  signals: readonly string[],
  lifecycle: FiledReturnsSummaryLifecycle,
): string {
  const signalSet = new Set(signals);
  if (
    signalSet.has("full-fiscal-year-summary-included") &&
    signalSet.has("full-fiscal-year-workbook-not-applicable")
  ) {
    const countSignal = signals.find((signal) =>
      signal.startsWith("full-fiscal-year-summary-parsed-period-count:"),
    );
    const count = Number(countSignal?.split(":").at(-1));
    const notApplicable = " A consolidated workbook is not available for this return type.";
    if (signalSet.has("full-fiscal-year-summary-outcomes-only")) {
      return summaryInclusionClaim(lifecycle, "an outcome-only tidy CSV") + notApplicable;
    }
    return (
      summaryInclusionClaim(
        lifecycle,
        Number.isInteger(count) && count >= 0 && count <= 12
          ? `the tidy CSV for ${count} ${count === 1 ? "period" : "periods"}`
          : "the tidy CSV",
      ) + notApplicable
    );
  }
  if (signalSet.has("full-fiscal-year-summary-outcomes-only")) {
    return summaryInclusionClaim(
      lifecycle,
      "the workbook and an outcome-only tidy CSV because no parseable portal JSON was available",
    );
  }
  if (signalSet.has("full-fiscal-year-summary-included")) {
    const countSignal = signals.find((signal) =>
      signal.startsWith("full-fiscal-year-summary-parsed-period-count:"),
    );
    const count = Number(countSignal?.split(":").at(-1));
    return summaryInclusionClaim(
      lifecycle,
      Number.isInteger(count) && count >= 0 && count <= 12
        ? `the workbook and tidy CSV for ${count} ${count === 1 ? "period" : "periods"}`
        : "the workbook and tidy CSV",
    );
  }
  if (signalSet.has("full-fiscal-year-summary-failed")) {
    const reason = filedReturnsSummaryFailureReason(signalSet);
    if (lifecycle === "intent") {
      return `Pack prepared the artifact ZIP without derived summary outputs because ${reason}.`;
    }
    if (lifecycle === "unconfirmed") {
      return `If the ZIP download completed, it does not include derived summary outputs because ${reason}.`;
    }
    return `Pack saved the artifact files without derived summary outputs because ${reason}.`;
  }
  return "";
}

function filedReturnsSummaryFailureReason(signals: ReadonlySet<string>): string {
  if (signals.has("full-fiscal-year-summary-error:identity-rejected")) {
    return "the taxpayer identity could not be validated; review the original return in the GST Portal, then retry";
  }
  if (signals.has("full-fiscal-year-summary-error:identity-unverified")) {
    return "the taxpayer identity was not present at its expected place in the portal response; review the original return in the GST Portal, then retry";
  }
  if (signals.has("full-fiscal-year-summary-error:identity-conflict")) {
    return "filed-return sources disagreed about the taxpayer identity; re-download the affected periods from the GST Portal, then retry";
  }
  if (signals.has("full-fiscal-year-summary-error:privacy-rejected")) {
    return "Pack's privacy boundary rejected the source data; review the original return in the GST Portal, then retry";
  }
  if (signals.has("full-fiscal-year-summary-error:too-large")) {
    return "the derived summary output exceeded its local size limit";
  }
  if (signals.has("full-fiscal-year-summary-error:workbook-generation-failed")) {
    return "workbook generation failed";
  }
  if (signals.has("full-fiscal-year-summary-error:response-invalid")) {
    return "the local result was invalid";
  }
  return "summary generation failed";
}

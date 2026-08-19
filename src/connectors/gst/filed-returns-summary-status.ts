import type { PackOffscreenFiledReturnSummaryResult } from "./offscreen-blob-url";

export interface FiledReturnsSummaryStatus {
  safeMessage?: string;
  safeSignals: string[];
}

export function filedReturnsSummaryOutcome(
  requested: boolean,
  result: PackOffscreenFiledReturnSummaryResult | undefined,
): FiledReturnsSummaryStatus {
  if (!requested) return { safeSignals: [] };
  if (!result) {
    return {
      safeSignals: [
        "full-fiscal-year-summary-failed",
        "full-fiscal-year-summary-error:response-invalid",
      ],
      safeMessage:
        "Pack saved the artifact files without derived summary outputs because the local result was invalid.",
    };
  }
  if (result.status === "failed") {
    return {
      safeSignals: [
        "full-fiscal-year-summary-failed",
        `full-fiscal-year-summary-error:${result.reasonCategory}`,
      ],
      safeMessage:
        result.reasonCategory === "too-large"
          ? "Pack saved the artifact files without derived summary outputs because the workbook and CSV exceeded their local size limit."
          : result.reasonCategory === "workbook-generation-failed"
            ? "Pack saved the artifact files without derived summary outputs because workbook generation failed."
            : "Pack saved the artifact files without derived summary outputs because summary generation failed.",
    };
  }
  return {
    safeSignals: [
      "full-fiscal-year-summary-included",
      ...(result.outcomeOnly ? ["full-fiscal-year-summary-outcomes-only"] : []),
      `full-fiscal-year-summary-parsed-period-count:${result.parsedPeriodCount}`,
      `full-fiscal-year-summary-row-count:${result.rowCount}`,
    ],
    safeMessage: result.outcomeOnly
      ? "The ZIP includes the workbook and an outcome-only tidy CSV because no parseable portal JSON was available."
      : `The ZIP includes the workbook and tidy CSV for ${result.parsedPeriodCount} ${result.parsedPeriodCount === 1 ? "period" : "periods"}.`,
  };
}

export function filedReturnsSummaryStatusMessage(signals: readonly string[]): string {
  const signalSet = new Set(signals);
  if (signalSet.has("full-fiscal-year-summary-outcomes-only")) {
    return " The ZIP includes the workbook and an outcome-only tidy CSV because no parseable portal JSON was available.";
  }
  if (signalSet.has("full-fiscal-year-summary-included")) {
    const countSignal = signals.find((signal) =>
      signal.startsWith("full-fiscal-year-summary-parsed-period-count:"),
    );
    const count = Number(countSignal?.split(":").at(-1));
    return Number.isInteger(count) && count >= 0 && count <= 12
      ? ` The ZIP includes the workbook and tidy CSV for ${count} ${count === 1 ? "period" : "periods"}.`
      : " The ZIP includes the workbook and tidy CSV.";
  }
  if (signalSet.has("full-fiscal-year-summary-failed")) {
    if (signalSet.has("full-fiscal-year-summary-error:too-large")) {
      return " Pack saved the artifact files without derived summary outputs because the workbook and CSV exceeded their local size limit.";
    }
    if (signalSet.has("full-fiscal-year-summary-error:workbook-generation-failed")) {
      return " Pack saved the artifact files without derived summary outputs because workbook generation failed.";
    }
    if (signalSet.has("full-fiscal-year-summary-error:response-invalid")) {
      return " Pack saved the artifact files without derived summary outputs because the local result was invalid.";
    }
    return " Pack saved the artifact files without derived summary outputs because summary generation failed.";
  }
  return "";
}

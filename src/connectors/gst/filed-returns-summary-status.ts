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
        "Pack saved the artifact files without a summary because the summary result was invalid.",
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
          ? "Pack saved the artifact files without a summary because the summary exceeded its local size limit."
          : "Pack saved the artifact files without a summary because summary generation failed.",
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
      ? "The summary contains outcome rows only because no parseable portal JSON was available."
      : `The summary includes portal-key rows for ${result.parsedPeriodCount} ${result.parsedPeriodCount === 1 ? "period" : "periods"}.`,
  };
}

export function filedReturnsSummaryStatusMessage(signals: readonly string[]): string {
  const signalSet = new Set(signals);
  if (signalSet.has("full-fiscal-year-summary-outcomes-only")) {
    return " The ZIP summary contains outcome rows only because no parseable portal JSON was available.";
  }
  if (signalSet.has("full-fiscal-year-summary-included")) {
    const countSignal = signals.find((signal) =>
      signal.startsWith("full-fiscal-year-summary-parsed-period-count:"),
    );
    const count = Number(countSignal?.split(":").at(-1));
    return Number.isInteger(count) && count >= 0 && count <= 12
      ? ` The ZIP summary includes portal-key rows for ${count} ${count === 1 ? "period" : "periods"}.`
      : " The ZIP includes a portal-key summary.";
  }
  if (signalSet.has("full-fiscal-year-summary-failed")) {
    if (signalSet.has("full-fiscal-year-summary-error:too-large")) {
      return " Pack saved the artifact files without a summary because the summary exceeded its local size limit.";
    }
    if (signalSet.has("full-fiscal-year-summary-error:response-invalid")) {
      return " Pack saved the artifact files without a summary because the summary result was invalid.";
    }
    return " Pack saved the artifact files without a summary because summary generation failed.";
  }
  return "";
}

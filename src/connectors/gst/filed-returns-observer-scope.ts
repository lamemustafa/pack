import { filedReturnScopeId } from "./filed-returns-return-descriptors";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import type { FiledReturnsObservation } from "./filed-returns-observer-types";

export function detectVisibleReturnLabel(signals: readonly string[]): FiledReturnsReturnType {
  return observedReturnLabel(signals) ?? "GSTR-3B";
}

export function observedReturnLabel(signals: readonly string[]): FiledReturnsReturnType | null {
  if (signals.includes("gstr-2b")) return "GSTR-2B";
  if (signals.includes("gstr-1")) return "GSTR-1";
  return signals.includes("gstr-3b") ? "GSTR-3B" : null;
}

export function scopeIdForVisibleReturnLabel(
  returnType: FiledReturnsReturnType,
): FiledReturnsObservation["scopeId"] {
  return filedReturnScopeId(returnType) as FiledReturnsObservation["scopeId"];
}

export function missingFiledReturnDownloadMessage(signals: readonly string[]): string {
  const label = observedReturnLabel(signals);
  return label
    ? `${label} is visible, but a filed-return download control is not visible.`
    : "The filed returns page is visible, but the requested return type is not visible yet.";
}

import { filedReturnScopeId } from "./filed-returns-return-descriptors";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import type { FiledReturnsObservation } from "./filed-returns-observer-types";

export function detectVisibleReturnLabel(signals: readonly string[]): FiledReturnsReturnType {
  if (signals.includes("gstr-2b")) return "GSTR-2B";
  if (signals.includes("gstr-1")) return "GSTR-1";
  return "GSTR-3B";
}

export function scopeIdForVisibleReturnLabel(
  returnType: FiledReturnsReturnType,
): FiledReturnsObservation["scopeId"] {
  return filedReturnScopeId(returnType) as FiledReturnsObservation["scopeId"];
}

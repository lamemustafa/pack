import type { FiledReturnsReturnType } from "../../core/filed-returns-return-types";
import type { FiledReturnsObservation } from "./filed-returns-observer-types";

export function detectVisibleReturnLabel(signals: readonly string[]): FiledReturnsReturnType {
  if (signals.includes("gstr-2b")) return "GSTR-2B";
  if (signals.includes("gstr-1")) return "GSTR-1";
  return "GSTR-3B";
}

export function scopeIdForVisibleReturnLabel(
  returnType: FiledReturnsReturnType,
): FiledReturnsObservation["scopeId"] {
  if (returnType === "GSTR-2B") return "gst-gstr2b-private-v0";
  if (returnType === "GSTR-1") return "gst-filed-returns-gstr1-pdf-private-v0";
  return "gst-filed-returns-gstr3b-pdf-private-v0";
}

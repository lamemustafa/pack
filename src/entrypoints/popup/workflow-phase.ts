import type { FiledReturnsFlowSummary } from "../../core/contracts";
import type { PopupPresentationState } from "./presentation-state";

export type PopupWorkflowPhase = "plan" | "run" | "results";

export function getPopupWorkflowPhase(
  presentation: PopupPresentationState,
  summary: FiledReturnsFlowSummary | null,
): PopupWorkflowPhase {
  if (presentation.kind === "downloading" || summary?.status === "running") return "run";
  if (summary && summary.status !== "cancelled") return "results";
  return "plan";
}

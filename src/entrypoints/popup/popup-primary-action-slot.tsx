import type { ReactNode } from "react";
import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";

export function PopupPrimaryActionSlot({
  children,
  recoverySummary,
  statusOwnsPrimaryAction,
}: {
  children: ReactNode;
  recoverySummary: FiledReturnsFlowSummary | null;
  statusOwnsPrimaryAction: boolean;
}) {
  return statusOwnsPrimaryAction || recoverySummary ? null : <>{children}</>;
}

import type { FiledReturnsFullFiscalYearLedger, PortalFlowStepResult } from "../core/contracts";
import { filedReturnsScopeId } from "../core/filed-returns-return-types";

export function fullFiscalYearZipPhaseStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult | null {
  if (ledger.zipPhase === "cleaned") return null;
  const legacyRetained = hasLegacyRetainedStaging(ledger);
  if (ledger.zipPhase === undefined && !legacyRetained) return null;
  if (ledger.zipPhase === "restaging-required") {
    return {
      connectorId: "gst",
      scopeId: filedReturnsScopeId(ledger.scope.returnType),
      state: "blocked",
      safeSignals: [
        "full-fiscal-year-run-needs-action",
        "full-fiscal-year-restaging-required",
        "gst-portal-tab-required",
        "full-fiscal-year-opfs-retained",
      ],
      safeMessage:
        "Pack must restage the saved fiscal-year periods from the GST Portal before rebuilding the ZIP.",
    };
  }

  const downloaded = ledger.zipPhase === "downloaded-cleanup-pending";
  const noArtifacts = ledger.zipPhase === "no-artifacts-cleanup-pending";
  const cleanup =
    downloaded || noArtifacts || ledger.zipPhase === "legacy-cleanup-pending" || legacyRetained;
  return {
    connectorId: "gst",
    scopeId: filedReturnsScopeId(ledger.scope.returnType),
    state: "blocked",
    safeSignals: [
      ...(cleanup
        ? ["full-fiscal-year-local-cleanup-retry"]
        : ["full-fiscal-year-final-zip-retry"]),
      ...(downloaded ? ["full-fiscal-year-zip-downloaded"] : []),
      ...(noArtifacts ? ["full-fiscal-year-no-zip-artifacts"] : []),
      legacyRetained
        ? "full-fiscal-year-zip-phase:legacy-cleanup-pending"
        : ledger.zipPhase === "export-pending"
          ? "full-fiscal-year-zip-export-pending"
          : `full-fiscal-year-zip-phase:${ledger.zipPhase}`,
      "full-fiscal-year-opfs-retained",
    ],
    safeMessage: cleanup
      ? "Pack retained local fiscal-year staging and can finish cleanup without reopening the GST Portal."
      : "Pack retained the prepared fiscal-year files and can retry the final ZIP without repeating portal periods.",
  };
}

export function hasLegacyRetainedStaging(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return (
    ledger.zipPhase === undefined &&
    ledger.status === "complete" &&
    ledger.targets.some((target) =>
      target.safeSignals.some(
        (signal) =>
          signal === "full-fiscal-year-opfs-staged" ||
          signal.startsWith("full-fiscal-year-opfs-staged:"),
      ),
    )
  );
}

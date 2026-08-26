import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTargetStatus,
} from "../../src/connectors/gst/filed-returns-contracts";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import {
  FILED_RETURNS_MONTHS,
  FULL_FISCAL_YEAR_PERIOD,
} from "../../src/connectors/gst/filed-returns-scope";
import { createFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";

export const RECOVERY_TARGET_STATUSES = [
  "pending",
  "running",
  "download-unconfirmed",
  "blocked",
  "failed",
  "cancelled",
  "manually-observed",
] as const satisfies readonly FiledReturnsFullFiscalYearTargetStatus[];

export const RECOVERY_NOW = new Date("2026-08-25T00:00:00.000Z");
export const RECOVERY_SCOPE = {
  artifactType: "PDF",
  financialYear: "2025-26",
  period: FULL_FISCAL_YEAR_PERIOD,
  returnType: "GSTR-3B",
} as const satisfies FiledReturnsDownloadScope;

/** Synthetic stored-state disagreement, not a claim about its workflow origin. */
export function makeCompletedRecoveryLedger(
  status: FiledReturnsFullFiscalYearTargetStatus,
  options: {
    stagedPositive?: boolean;
    positiveFirst?: boolean;
    currentPositive?: boolean;
  } = {},
): FiledReturnsFullFiscalYearLedger {
  const ledger = createFullFiscalYearLedger(
    RECOVERY_SCOPE,
    new Date("2026-08-24T00:00:00.000Z"),
    FILED_RETURNS_MONTHS,
  );
  const recoveryIndex = options.positiveFirst ? 1 : 0;
  const positiveIndex = options.positiveFirst ? 0 : 1;
  const targets = ledger.targets.map((target, index) => {
    const targetStatus =
      index === recoveryIndex
        ? status
        : index === positiveIndex && options.stagedPositive
          ? "downloaded"
          : "not-filed";
    const signals =
      targetStatus === "downloaded"
        ? ["filed-return-artifact-downloaded:PDF", "full-fiscal-year-opfs-staged:PDF"]
        : targetStatus === "not-filed"
          ? ["filed-return-positively-not-filed"]
          : [];
    return {
      ...target,
      status: targetStatus,
      attempts: targetStatus === "pending" ? 0 : 1,
      ...canonicalDurableTargetStatus(target, targetStatus, signals),
      ...(targetStatus === "downloaded"
        ? {
            downloadDiagnostic: {
              schemaVersion: "1.0" as const,
              eventType: "filed-return-download-path" as const,
              actionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
              returnType: target.returnType,
              financialYear: target.financialYear,
              period: target.period,
              artifactType: "PDF" as const,
              endpointClass: "gstr3b-portal-blob-captured-download" as const,
              downloadPathClass: "captured-portal-request-data" as const,
              status: "downloaded" as const,
              mimeClass: "pdf" as const,
              byteCountClass: "non-empty" as const,
            },
          }
        : {}),
    };
  });
  return {
    ...ledger,
    ledgerId: "full-fiscal-year-00000020",
    revision: 7,
    status: "complete",
    currentTargetId: targets[options.currentPositive ? positiveIndex : recoveryIndex]!.targetId,
    targets,
  };
}

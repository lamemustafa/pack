import type { FiledReturnsFlowSummary } from "./filed-returns-contracts";

export interface Gstr3bPdfDiagnosticProbe {
  attempt: "absent" | "present";
  outcome: "running" | "confirmed" | "unconfirmed" | "blocked" | "cancelled";
  reasonClass:
    | "no-matching-gstr3b-pdf-attempt"
    | "run-in-progress"
    | "exact-download-confirmed"
    | "completion-without-exact-download"
    | "download-awaiting-confirmation"
    | "flow-blocked"
    | "flow-cancelled";
  evidence: {
    exactDownloadObserved: boolean;
    terminalComplete: boolean;
    nonEmpty: boolean;
    browserSafe: boolean;
  };
}

const ABSENT_PROBE: Gstr3bPdfDiagnosticProbe = {
  attempt: "absent",
  outcome: "unconfirmed",
  reasonClass: "no-matching-gstr3b-pdf-attempt",
  evidence: {
    exactDownloadObserved: false,
    terminalComplete: false,
    nonEmpty: false,
    browserSafe: false,
  },
};

/**
 * Creates the only response shape permitted for a popup-console diagnostic.
 * It intentionally omits scope, identifiers, diagnostics, messages, and signals.
 */
export function gstr3bPdfDiagnosticProbe(
  summary: FiledReturnsFlowSummary | null,
): Gstr3bPdfDiagnosticProbe {
  if (!isGstr3bPdfSummary(summary)) return ABSENT_PROBE;

  const terminalComplete = summary.status === "complete";
  const exactDownloadObserved =
    terminalComplete &&
    summary.flowStep.state === "downloaded" &&
    (summary.artifactAcquisitionCompletion?.length ?? 0) > 0;
  const confirmedEvidence = {
    exactDownloadObserved,
    terminalComplete,
    nonEmpty: exactDownloadObserved,
    browserSafe: exactDownloadObserved,
  };

  if (summary.status === "running") {
    return presentProbe("running", "run-in-progress", confirmedEvidence);
  }
  if (summary.status === "cancelled") {
    return presentProbe("cancelled", "flow-cancelled", confirmedEvidence);
  }
  if (summary.status === "blocked") {
    return presentProbe("blocked", "flow-blocked", confirmedEvidence);
  }
  if (exactDownloadObserved) {
    return presentProbe("confirmed", "exact-download-confirmed", confirmedEvidence);
  }
  if (terminalComplete) {
    return presentProbe("unconfirmed", "completion-without-exact-download", confirmedEvidence);
  }
  return presentProbe("unconfirmed", "download-awaiting-confirmation", confirmedEvidence);
}

function presentProbe(
  outcome: Gstr3bPdfDiagnosticProbe["outcome"],
  reasonClass: Gstr3bPdfDiagnosticProbe["reasonClass"],
  evidence: Gstr3bPdfDiagnosticProbe["evidence"],
): Gstr3bPdfDiagnosticProbe {
  return { attempt: "present", outcome, reasonClass, evidence };
}

function isGstr3bPdfSummary(
  summary: FiledReturnsFlowSummary | null,
): summary is FiledReturnsFlowSummary {
  return (
    summary?.scope.returnType === "GSTR-3B" &&
    (summary.scope.artifactType === undefined || summary.scope.artifactType === "PDF")
  );
}

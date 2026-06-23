import type {
  ArchiveManifest,
  ArchiveManifestDocument,
  ArchiveManifestException,
  DownloadPlan,
  DownloadResult,
  TerminalStatus,
} from "./contracts";

const TERMINAL_STATUSES: readonly TerminalStatus[] = [
  "downloaded",
  "not-filed",
  "not-applicable",
  "unavailable-on-portal",
  "generation-pending",
  "cancelled-by-user",
  "failed-retryable-exhausted",
  "failed-permanent",
  "unknown",
];

export interface ManifestEnvironment {
  productVersion: string;
  build: string;
  officialUrl: string;
  startedAt: string;
  completedAt: string;
  browserFamily?: string;
  browserMajor?: string;
}

export function createArchiveManifest(
  plan: DownloadPlan,
  results: readonly DownloadResult[],
  environment: ManifestEnvironment,
): ArchiveManifest {
  const resultByTarget = new Map(results.map((result) => [result.targetId, result]));
  const documents: ArchiveManifestDocument[] = plan.targets.map((target) => {
    const result = resultByTarget.get(target.targetId) ?? unresolvedResult(target.targetId);

    return {
      target_id: target.targetId,
      document_type: target.documentType,
      ...(target.financialYear ? { financial_year: target.financialYear } : {}),
      ...(target.period ? { period: target.period } : {}),
      source_kind: target.expectedSourceKind,
      status: result.status,
      ...(result.artifact ? { artifact: result.artifact } : {}),
      ...(result.portalMetadata ? { portal_metadata: result.portalMetadata } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.startedAt ? { started_at: result.startedAt } : {}),
      completed_at: result.completedAt,
    };
  });

  const exceptions: ArchiveManifestException[] = documents
    .filter((document) => document.status !== "downloaded")
    .map((document) => ({
      target_id: document.target_id,
      status: document.status,
      retryable:
        document.status === "generation-pending" ||
        document.status === "failed-retryable-exhausted" ||
        document.error?.retryable === true,
      safe_message: document.error?.safeMessage ?? statusSafeMessage(document.status),
    }));

  const failed =
    countStatus(documents, "failed-permanent") +
    countStatus(documents, "failed-retryable-exhausted");

  return {
    schema_version: "1.0",
    manifest_id: `manifest-${plan.planId}`,
    created_at: environment.completedAt,
    product: {
      name: "ComplyEaze Pack",
      version: environment.productVersion,
      build: environment.build,
      official_url: environment.officialUrl,
    },
    connector: {
      id: plan.connector.id,
      version: plan.connector.version,
      compatibility_version: plan.connector.compatibilityVersion,
      portal_label: plan.connector.displayName,
    },
    execution: {
      mode: plan.executionMode,
      job_id: plan.planId,
      started_at: environment.startedAt,
      completed_at: environment.completedAt,
      completion_state: completionState(documents.map((document) => document.status)),
      ...(environment.browserFamily ? { browser_family: environment.browserFamily } : {}),
      ...(environment.browserMajor ? { browser_major: environment.browserMajor } : {}),
    },
    subject: {
      ...(plan.scope.subjectRef?.type ? { identifier_type: plan.scope.subjectRef.type } : {}),
      ...(plan.scope.subjectRef?.displayValue ? { value: plan.scope.subjectRef.displayValue } : {}),
      ...(plan.scope.subjectRef?.displayValue
        ? { display_label: plan.scope.subjectRef.displayValue }
        : {}),
      privacy_classification: plan.scope.subjectRef?.sensitivity ?? "not-collected",
    },
    scope: plan.scope,
    documents,
    exceptions,
    summary: {
      total_planned: plan.targets.length,
      downloaded: countStatus(documents, "downloaded"),
      "not-filed": countStatus(documents, "not-filed"),
      "not-applicable": countStatus(documents, "not-applicable"),
      "unavailable-on-portal": countStatus(documents, "unavailable-on-portal"),
      "generation-pending": countStatus(documents, "generation-pending"),
      "cancelled-by-user": countStatus(documents, "cancelled-by-user"),
      "failed-retryable-exhausted": countStatus(documents, "failed-retryable-exhausted"),
      "failed-permanent": countStatus(documents, "failed-permanent"),
      unknown: countStatus(documents, "unknown"),
      failed,
      manifest_integrity_state: "not-computed",
    },
    privacy: {
      local_only: true,
      contains_sensitive_tax_data: plan.scope.subjectRef !== undefined,
      credentials_collected: false,
      cookies_collected: false,
      uploaded_to_complyeaze: false,
    },
  };
}

export function assertAllTargetsTerminal(
  plan: DownloadPlan,
  results: readonly DownloadResult[],
): void {
  const resultIds = new Set(results.map((result) => result.targetId));
  const missing = plan.targets.filter((target) => !resultIds.has(target.targetId));
  if (missing.length > 0) {
    throw new Error(
      `Missing terminal result for targets: ${missing.map((target) => target.targetId).join(", ")}`,
    );
  }

  for (const result of results) {
    if (!TERMINAL_STATUSES.includes(result.status)) {
      throw new Error(`Invalid terminal status for ${result.targetId}: ${result.status}`);
    }
  }
}

function unresolvedResult(targetId: string): DownloadResult {
  return {
    schemaVersion: "1.0",
    targetId,
    status: "unknown",
    completedAt: new Date(0).toISOString(),
    error: {
      code: "UNKNOWN_SAFE_ERROR",
      retryable: false,
      safeMessage: "Pack could not safely determine the final state for this target.",
    },
  };
}

function countStatus(
  documents: readonly { status: TerminalStatus }[],
  status: TerminalStatus,
): number {
  return documents.filter((document) => document.status === status).length;
}

function completionState(
  statuses: readonly TerminalStatus[],
): ArchiveManifest["execution"]["completion_state"] {
  if (
    statuses.every(
      (status) => status === "downloaded" || status === "not-applicable" || status === "not-filed",
    )
  ) {
    return "complete";
  }
  if (statuses.every((status) => status === "cancelled-by-user")) return "cancelled";
  if (statuses.some((status) => status === "downloaded")) return "partial";
  return "failed";
}

function statusSafeMessage(status: TerminalStatus): string {
  switch (status) {
    case "downloaded":
      return "Downloaded.";
    case "not-filed":
      return "The target appears applicable but the filing was not found as filed.";
    case "not-applicable":
      return "The connector classified this target as not applicable.";
    case "unavailable-on-portal":
      return "The portal did not make this file available in the current flow.";
    case "generation-pending":
      return "The portal indicates that generation is still pending.";
    case "cancelled-by-user":
      return "The user cancelled this target before completion.";
    case "failed-retryable-exhausted":
      return "A retryable failure persisted beyond the bounded retry policy.";
    case "failed-permanent":
      return "Pack hit a deterministic failure for this target.";
    case "unknown":
      return "Pack could not safely classify this target.";
  }
}

import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypesForSelection,
  normaliseFiledReturnsArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import { isFiledReturnsReturnType } from "../connectors/gst/filed-returns-return-types";
import {
  FILED_RETURNS_MONTHS,
  type FiledReturnsMonth,
} from "../connectors/gst/filed-returns-scope";
import {
  createFiledReturnsLedgerId,
  isCanonicalSinglePeriodLedgerId,
} from "../connectors/gst/filed-returns-ledger-id";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { isValidFiledReturnsDownloadDiagnosticState } from "./filed-returns-download-diagnostic-state";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";
const MISSING_ARTIFACT_REASONS = new Set(["artifact-filed-gstr1-excel-no-details-available"]);

const LEDGER_KEYS = [
  "artifactPlan",
  "artifacts",
  "createdAt",
  "ledgerId",
  "phase",
  "revision",
  "schemaVersion",
  "scope",
  "updatedAt",
  "zipDownloadAttempt",
] as const;
const SCOPE_KEYS = ["artifactType", "financialYear", "period", "returnType"] as const;
const ARTIFACT_KEYS = [
  "artifactType",
  "completedAt",
  "downloadDiagnostic",
  "missingReason",
  "safeSignals",
  "startedAt",
  "status",
  "updatedAt",
] as const;
const ZIP_ATTEMPT_KEYS = ["downloadId", "requestedAt"] as const;

export type SinglePeriodBundleArtifactStatus = "pending" | "running" | "staged" | "unavailable";

export type SinglePeriodBundlePhase =
  | "collecting"
  | "artifact-review"
  | "ready-for-zip"
  | "zip-intent-persisted"
  | "zip-observing"
  | "cleanup-pending";

export interface SinglePeriodBundleArtifact {
  artifactType: FiledReturnsConcreteArtifactType;
  status: SinglePeriodBundleArtifactStatus;
  safeSignals: string[];
  downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
  missingReason?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface SinglePeriodBundleLedger {
  artifactPlan: FiledReturnsConcreteArtifactType[];
  artifacts: SinglePeriodBundleArtifact[];
  createdAt: string;
  ledgerId: string;
  phase: SinglePeriodBundlePhase;
  revision: number;
  schemaVersion: "1.0";
  scope: FiledReturnsDownloadScope;
  updatedAt: string;
  zipDownloadAttempt?: {
    requestedAt: string;
    downloadId?: number;
  };
}

export type SinglePeriodBundleLedgerStorageState =
  | { state: "missing" }
  | { ledgerId: string; state: "legacy" }
  | { recoverableLedgerId: string | null; state: "malformed" }
  | { ledger: SinglePeriodBundleLedger; state: "valid" };

export type SinglePeriodBundleReservation =
  | { ledger: SinglePeriodBundleLedger; state: "created" }
  | { ledger: SinglePeriodBundleLedger; state: "existing" }
  | { recoverableLedgerId: string | null; state: "malformed" };

let bundleLedgerCriticalSection = Promise.resolve();

export function createSinglePeriodBundleLedger(
  scope: FiledReturnsDownloadScope,
  ledgerId: string,
  now: Date,
): SinglePeriodBundleLedger | null {
  if (!isSupportedBundleScope(scope) || !isCanonicalSinglePeriodLedgerId(ledgerId)) return null;
  let timestamp: string;
  try {
    timestamp = now.toISOString();
  } catch {
    return null;
  }
  const artifactPlan = concreteFiledReturnsArtifactTypesForSelection(
    scope.returnType,
    scope.artifactType,
  );
  return {
    artifactPlan,
    artifacts: artifactPlan.map((artifactType) => ({
      artifactType,
      safeSignals: ["single-period-bundle-artifact-pending"],
      status: "pending",
      updatedAt: timestamp,
    })),
    createdAt: timestamp,
    ledgerId,
    phase: "collecting",
    revision: 1,
    schemaVersion: "1.0",
    scope: {
      artifactType: "PDF_AND_EXCEL",
      financialYear: scope.financialYear,
      period: scope.period,
      returnType: scope.returnType,
    },
    updatedAt: timestamp,
  };
}

export async function reserveSinglePeriodBundleLedger(
  scope: FiledReturnsDownloadScope,
  now = new Date(),
): Promise<SinglePeriodBundleReservation | null> {
  if (!isSupportedBundleScope(scope)) return null;
  try {
    return await runBundleLedgerCriticalSection(async () => {
      const current = await readSinglePeriodBundleLedgerStorageState();
      if (current.state === "malformed") return current;
      if (current.state === "legacy") {
        return { recoverableLedgerId: current.ledgerId, state: "malformed" };
      }
      if (current.state === "valid") return { ledger: current.ledger, state: "existing" };

      const ledger = createSinglePeriodBundleLedger(
        scope,
        createSinglePeriodBundleLedgerId(now),
        now,
      );
      if (!ledger) return null;
      await browser.storage.local.set({ [PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging]: ledger });
      return { ledger, state: "created" };
    });
  } catch {
    return null;
  }
}

export async function readSinglePeriodBundleLedgerStorageState(): Promise<SinglePeriodBundleLedgerStorageState> {
  const values = await browser.storage.local.get(PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging);
  const stored = values[PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging];
  if (stored === undefined || stored === null) return { state: "missing" };
  const ledger = parseSinglePeriodBundleLedger(stored);
  if (ledger) return { ledger, state: "valid" };
  const legacyLedgerId = exactLegacySinglePeriodStagingLedgerId(stored);
  return legacyLedgerId
    ? { ledgerId: legacyLedgerId, state: "legacy" }
    : { recoverableLedgerId: recoverableLedgerId(stored), state: "malformed" };
}

export async function persistSinglePeriodBundleArtifactRunning(
  expectedLedger: SinglePeriodBundleLedger,
  artifactType: FiledReturnsConcreteArtifactType,
  now = new Date(),
): Promise<SinglePeriodBundleLedger | null> {
  return transitionStoredLedger(expectedLedger, (ledger) =>
    markSinglePeriodBundleArtifactRunning(ledger, artifactType, now),
  );
}

export async function persistSinglePeriodBundleArtifactStaged(
  expectedLedger: SinglePeriodBundleLedger,
  artifactType: FiledReturnsConcreteArtifactType,
  flowStep: PortalFlowStepResult,
  now = new Date(),
): Promise<SinglePeriodBundleLedger | null> {
  return transitionStoredLedger(expectedLedger, (ledger) =>
    markSinglePeriodBundleArtifactStaged(ledger, artifactType, flowStep, now),
  );
}

export async function persistSinglePeriodBundleArtifactUnavailable(
  expectedLedger: SinglePeriodBundleLedger,
  artifactType: FiledReturnsConcreteArtifactType,
  flowStep: PortalFlowStepResult,
  now = new Date(),
): Promise<SinglePeriodBundleLedger | null> {
  return transitionStoredLedger(expectedLedger, (ledger) =>
    markSinglePeriodBundleArtifactUnavailable(ledger, artifactType, flowStep, now),
  );
}

export async function persistSinglePeriodBundleArtifactReview(
  expectedLedger: SinglePeriodBundleLedger,
  artifactType: FiledReturnsConcreteArtifactType,
  flowStep: PortalFlowStepResult,
  now = new Date(),
): Promise<SinglePeriodBundleLedger | null> {
  return transitionStoredLedger(expectedLedger, (ledger) =>
    markSinglePeriodBundleArtifactReview(ledger, artifactType, flowStep, now),
  );
}

export async function persistSinglePeriodBundleZipIntent(
  expectedLedger: SinglePeriodBundleLedger,
  requestedAt: Date,
): Promise<SinglePeriodBundleLedger | null> {
  return transitionStoredLedger(expectedLedger, (ledger) =>
    markSinglePeriodBundleZipIntent(ledger, requestedAt),
  );
}

export async function persistSinglePeriodBundleZipDownloadId(
  expectedLedger: SinglePeriodBundleLedger,
  downloadId: number,
  now = new Date(),
): Promise<SinglePeriodBundleLedger | null> {
  return transitionStoredLedger(expectedLedger, (ledger) =>
    markSinglePeriodBundleZipDownloadId(ledger, downloadId, now),
  );
}

export async function persistSinglePeriodBundleCleanupPending(
  expectedLedger: SinglePeriodBundleLedger,
  now = new Date(),
): Promise<SinglePeriodBundleLedger | null> {
  return transitionStoredLedger(expectedLedger, (ledger) =>
    ledger.phase === "zip-observing" ? nextLedger(ledger, now, { phase: "cleanup-pending" }) : null,
  );
}

export async function clearSinglePeriodBundleLedger(
  ledgerId: string,
  expectedRevision: number,
): Promise<boolean> {
  if (
    !isCanonicalSinglePeriodLedgerId(ledgerId) ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 ||
    expectedRevision > 1_000_000
  ) {
    return false;
  }
  try {
    return await runBundleLedgerCriticalSection(async () => {
      const current = await readSinglePeriodBundleLedgerStorageState();
      if (current.state === "missing") return true;
      if (
        current.state !== "valid" ||
        current.ledger.ledgerId !== ledgerId ||
        current.ledger.revision !== expectedRevision
      ) {
        return false;
      }
      await browser.storage.local.remove(PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging);
      return true;
    });
  } catch {
    return false;
  }
}

export async function clearLegacySinglePeriodStagingRecord(ledgerId: string): Promise<boolean> {
  if (!isCanonicalSinglePeriodLedgerId(ledgerId)) return false;
  try {
    return await runBundleLedgerCriticalSection(async () => {
      const current = await readSinglePeriodBundleLedgerStorageState();
      if (current.state === "missing") return true;
      if (current.state !== "legacy" || current.ledgerId !== ledgerId) return false;
      await browser.storage.local.remove(PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging);
      return true;
    });
  } catch {
    return false;
  }
}

export function markSinglePeriodBundleArtifactRunning(
  ledger: SinglePeriodBundleLedger,
  artifactType: FiledReturnsConcreteArtifactType,
  now: Date,
): SinglePeriodBundleLedger | null {
  if (ledger.phase !== "collecting") return null;
  const artifact = ledger.artifacts.find((candidate) => candidate.artifactType === artifactType);
  const nextPendingArtifact = ledger.artifacts.find((candidate) => candidate.status === "pending");
  if (
    !artifact ||
    artifact.status !== "pending" ||
    nextPendingArtifact?.artifactType !== artifactType ||
    ledger.artifacts.some((candidate) => candidate.status === "running")
  ) {
    return null;
  }
  return updateArtifact(ledger, artifactType, now, {
    artifactType,
    safeSignals: ["single-period-bundle-artifact-running"],
    startedAt: now.toISOString(),
    status: "running",
    updatedAt: now.toISOString(),
  });
}

export function markSinglePeriodBundleArtifactStaged(
  ledger: SinglePeriodBundleLedger,
  artifactType: FiledReturnsConcreteArtifactType,
  flowStep: PortalFlowStepResult,
  now: Date,
): SinglePeriodBundleLedger | null {
  const artifact = ledger.artifacts.find((candidate) => candidate.artifactType === artifactType);
  const diagnostic = validArtifactDiagnostic(flowStep, ledger.scope, artifactType);
  if (
    ledger.phase !== "collecting" ||
    !artifact ||
    artifact.status !== "running" ||
    !diagnostic ||
    flowStep.state !== "downloaded" ||
    !flowStep.safeSignals.includes("single-period-opfs-staged") ||
    !flowStep.safeSignals.includes(`single-period-opfs-staged:${artifactType}`) ||
    !flowStep.safeSignals.includes(`filed-return-artifact-downloaded:${artifactType}`)
  ) {
    return null;
  }
  const updated = updateArtifact(ledger, artifactType, now, {
    artifactType,
    completedAt: now.toISOString(),
    downloadDiagnostic: diagnostic,
    safeSignals: [
      "single-period-bundle-artifact-staged",
      `single-period-opfs-staged:${artifactType}`,
    ],
    startedAt: artifact.startedAt!,
    status: "staged",
    updatedAt: now.toISOString(),
  });
  if (!updated) return null;
  return allArtifactsTerminal(updated) ? { ...updated, phase: "ready-for-zip" } : updated;
}

export function markSinglePeriodBundleArtifactUnavailable(
  ledger: SinglePeriodBundleLedger,
  artifactType: FiledReturnsConcreteArtifactType,
  flowStep: PortalFlowStepResult,
  now: Date,
): SinglePeriodBundleLedger | null {
  const artifact = ledger.artifacts.find((candidate) => candidate.artifactType === artifactType);
  if (
    ledger.phase !== "collecting" ||
    !artifact ||
    artifact.status !== "running" ||
    flowStep.state === "downloaded"
  ) {
    return null;
  }
  const diagnostic = optionalArtifactDiagnostic(flowStep, ledger.scope, artifactType);
  const missingReason = missingArtifactReason(flowStep);
  if (!missingReason) return null;
  const updated = updateArtifact(ledger, artifactType, now, {
    artifactType,
    completedAt: now.toISOString(),
    ...(diagnostic ? { downloadDiagnostic: diagnostic } : {}),
    missingReason,
    safeSignals: ["single-period-bundle-artifact-unavailable"],
    startedAt: artifact.startedAt!,
    status: "unavailable",
    updatedAt: now.toISOString(),
  });
  if (!updated) return null;
  return allArtifactsTerminal(updated) ? { ...updated, phase: "ready-for-zip" } : updated;
}

export function markSinglePeriodBundleArtifactReview(
  ledger: SinglePeriodBundleLedger,
  artifactType: FiledReturnsConcreteArtifactType,
  flowStep: PortalFlowStepResult,
  now: Date,
): SinglePeriodBundleLedger | null {
  const artifact = ledger.artifacts.find((candidate) => candidate.artifactType === artifactType);
  if (ledger.phase !== "collecting" || !artifact || artifact.status !== "running") return null;
  const diagnostic = optionalArtifactDiagnostic(flowStep, ledger.scope, artifactType);
  const updated = updateArtifact(ledger, artifactType, now, {
    artifactType,
    ...(diagnostic ? { downloadDiagnostic: diagnostic } : {}),
    safeSignals: ["single-period-bundle-artifact-running"],
    startedAt: artifact.startedAt!,
    status: "running",
    updatedAt: now.toISOString(),
  });
  return updated ? { ...updated, phase: "artifact-review" } : null;
}

export function markSinglePeriodBundleZipIntent(
  ledger: SinglePeriodBundleLedger,
  requestedAt: Date,
): SinglePeriodBundleLedger | null {
  if (ledger.phase !== "ready-for-zip") return null;
  return nextLedger(ledger, requestedAt, {
    phase: "zip-intent-persisted",
    zipDownloadAttempt: { requestedAt: requestedAt.toISOString() },
  });
}

export function markSinglePeriodBundleZipDownloadId(
  ledger: SinglePeriodBundleLedger,
  downloadId: number,
  now: Date,
): SinglePeriodBundleLedger | null {
  if (
    ledger.phase !== "zip-intent-persisted" ||
    !ledger.zipDownloadAttempt ||
    !Number.isSafeInteger(downloadId) ||
    downloadId < 0
  ) {
    return null;
  }
  return nextLedger(ledger, now, {
    phase: "zip-observing",
    zipDownloadAttempt: {
      requestedAt: ledger.zipDownloadAttempt.requestedAt,
      downloadId,
    },
  });
}

export function singlePeriodBundleEntryPlan(ledger: SinglePeriodBundleLedger): {
  artifactTypes: FiledReturnsConcreteArtifactType[];
  unavailableArtifactTypes: FiledReturnsConcreteArtifactType[];
} | null {
  if (
    !allArtifactsTerminal(ledger) ||
    ledger.phase === "collecting" ||
    ledger.phase === "artifact-review"
  ) {
    return null;
  }
  const artifactTypes = ledger.artifacts
    .filter((artifact) => artifact.status === "staged")
    .map((artifact) => artifact.artifactType);
  const unavailableArtifactTypes = ledger.artifacts
    .filter((artifact) => artifact.status === "unavailable")
    .map((artifact) => artifact.artifactType);
  return { artifactTypes, unavailableArtifactTypes };
}

export function singlePeriodBundleFlowStep(
  ledger: SinglePeriodBundleLedger,
): PortalFlowStepResult | null {
  const completedArtifacts = ledger.artifacts.filter(
    (artifact) => artifact.status === "staged" || artifact.status === "unavailable",
  );
  if (completedArtifacts.length === 0) return null;
  const diagnostics = completedArtifacts
    .map((artifact) => artifact.downloadDiagnostic)
    .filter((diagnostic): diagnostic is FiledReturnsDownloadDiagnostic => Boolean(diagnostic));
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(ledger.scope.returnType),
    state: ledger.artifacts.some((artifact) => artifact.status === "unavailable")
      ? "partial"
      : "downloaded",
    safeSignals: Array.from(
      new Set([
        "single-period-bundle-recovered",
        ...completedArtifacts.flatMap((artifact) =>
          artifact.status === "staged"
            ? [
                `filed-return-artifact-downloaded:${artifact.artifactType}`,
                "single-period-opfs-staged",
                `single-period-opfs-staged:${artifact.artifactType}`,
              ]
            : [
                `filed-return-artifact-unavailable:${artifact.artifactType}`,
                artifact.missingReason!,
              ],
        ),
      ]),
    ),
    safeMessage: bundleSafeMessage(ledger),
    ...(diagnostics.length > 0
      ? {
          downloadDiagnostic: diagnostics.at(-1)!,
          downloadDiagnostics: diagnostics,
        }
      : {}),
  };
}

export function sameSinglePeriodBundleScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType) ===
      normaliseFiledReturnsArtifactType(right.returnType, right.artifactType)
  );
}

function parseSinglePeriodBundleLedger(input: unknown): SinglePeriodBundleLedger | null {
  if (!input || typeof input !== "object") return null;
  const ledger = input as Partial<SinglePeriodBundleLedger> & Record<string, unknown>;
  if (!hasOnlyKeys(ledger, LEDGER_KEYS) || ledger.schemaVersion !== "1.0") return null;
  if (!isCanonicalSinglePeriodLedgerId(ledger.ledgerId)) return null;
  if (
    !Number.isSafeInteger(ledger.revision) ||
    Number(ledger.revision) < 1 ||
    Number(ledger.revision) > 1_000_000
  ) {
    return null;
  }
  if (!isCanonicalTimestamp(ledger.createdAt) || !isCanonicalTimestamp(ledger.updatedAt))
    return null;
  if (Date.parse(ledger.createdAt) > Date.parse(ledger.updatedAt)) return null;
  if (!isBundlePhase(ledger.phase) || !isSupportedBundleScope(ledger.scope)) return null;
  if (!hasOnlyKeys(ledger.scope as unknown as Record<string, unknown>, SCOPE_KEYS)) return null;
  const artifactPlan = parsedArtifactPlan(
    ledger.scope as FiledReturnsDownloadScope,
    ledger.artifactPlan,
  );
  if (!artifactPlan || !Array.isArray(ledger.artifacts)) return null;
  if (ledger.artifacts.length !== artifactPlan.length) return null;
  const artifacts = ledger.artifacts.map((artifact, index) =>
    parseArtifact(
      artifact,
      ledger.scope as FiledReturnsDownloadScope,
      artifactPlan[index]!,
      ledger.createdAt as string,
      ledger.updatedAt as string,
    ),
  );
  if (artifacts.some((artifact) => !artifact)) return null;
  if (!validPhaseState(ledger.phase, artifacts as SinglePeriodBundleArtifact[])) return null;
  const zipDownloadAttempt = parseZipAttempt(
    ledger.zipDownloadAttempt,
    ledger.phase,
    ledger.createdAt,
    ledger.updatedAt,
  );
  if (zipDownloadAttempt === false) return null;
  return {
    artifactPlan,
    artifacts: artifacts as SinglePeriodBundleArtifact[],
    createdAt: ledger.createdAt,
    ledgerId: ledger.ledgerId,
    phase: ledger.phase,
    revision: ledger.revision as number,
    schemaVersion: "1.0",
    scope: { ...(ledger.scope as FiledReturnsDownloadScope) },
    updatedAt: ledger.updatedAt,
    ...(zipDownloadAttempt ? { zipDownloadAttempt } : {}),
  };
}

function parseArtifact(
  input: unknown,
  scope: FiledReturnsDownloadScope,
  expectedArtifactType: FiledReturnsConcreteArtifactType,
  ledgerCreatedAt: string,
  ledgerUpdatedAt: string,
): SinglePeriodBundleArtifact | null {
  if (!input || typeof input !== "object") return null;
  const artifact = input as Partial<SinglePeriodBundleArtifact> & Record<string, unknown>;
  if (!hasOnlyKeys(artifact, ARTIFACT_KEYS)) return null;
  if (artifact.artifactType !== expectedArtifactType || !isArtifactStatus(artifact.status)) {
    return null;
  }
  if (!isCanonicalTimestamp(artifact.updatedAt)) return null;
  if (
    Date.parse(artifact.updatedAt) < Date.parse(ledgerCreatedAt) ||
    Date.parse(artifact.updatedAt) > Date.parse(ledgerUpdatedAt)
  ) {
    return null;
  }
  const expectedSignals = statusSignals(artifact.status, expectedArtifactType);
  if (!sameStrings(artifact.safeSignals, expectedSignals)) return null;
  if (artifact.startedAt !== undefined && !isCanonicalTimestamp(artifact.startedAt)) return null;
  if (artifact.completedAt !== undefined && !isCanonicalTimestamp(artifact.completedAt))
    return null;
  if (
    artifact.startedAt !== undefined &&
    (Date.parse(artifact.startedAt) < Date.parse(ledgerCreatedAt) ||
      Date.parse(artifact.startedAt) > Date.parse(artifact.updatedAt))
  ) {
    return null;
  }
  if (
    artifact.completedAt !== undefined &&
    (!artifact.startedAt ||
      Date.parse(artifact.completedAt) < Date.parse(artifact.startedAt) ||
      Date.parse(artifact.completedAt) > Date.parse(artifact.updatedAt))
  ) {
    return null;
  }
  const diagnostic = optionalArtifactDiagnostic(artifact, scope, expectedArtifactType);
  if (artifact.downloadDiagnostic !== undefined && !diagnostic) return null;

  if (artifact.status === "pending") {
    if (
      artifact.startedAt ||
      artifact.completedAt ||
      artifact.downloadDiagnostic ||
      artifact.missingReason
    ) {
      return null;
    }
  } else if (artifact.status === "running") {
    if (!artifact.startedAt || artifact.completedAt || artifact.missingReason) return null;
  } else if (artifact.status === "staged") {
    if (!artifact.startedAt || !artifact.completedAt || !diagnostic || artifact.missingReason) {
      return null;
    }
    if (diagnostic.byteCountClass !== "non-empty") return null;
    if (expectedArtifactType === "PDF" && diagnostic.mimeClass !== "pdf") return null;
    if (expectedArtifactType === "JSON" && diagnostic.mimeClass !== "json") return null;
    if (expectedArtifactType === "EXCEL" && diagnostic.mimeClass !== "spreadsheet") return null;
  } else if (
    !artifact.startedAt ||
    !artifact.completedAt ||
    !isMissingReason(artifact.missingReason)
  ) {
    return null;
  }

  return {
    artifactType: expectedArtifactType,
    ...(artifact.completedAt ? { completedAt: artifact.completedAt } : {}),
    ...(diagnostic ? { downloadDiagnostic: diagnostic } : {}),
    ...(artifact.missingReason ? { missingReason: artifact.missingReason } : {}),
    safeSignals: expectedSignals,
    ...(artifact.startedAt ? { startedAt: artifact.startedAt } : {}),
    status: artifact.status,
    updatedAt: artifact.updatedAt,
  };
}

function parseZipAttempt(
  input: unknown,
  phase: SinglePeriodBundlePhase,
  ledgerCreatedAt: string,
  ledgerUpdatedAt: string,
): SinglePeriodBundleLedger["zipDownloadAttempt"] | false | null {
  const requiresIntent = ["zip-intent-persisted", "zip-observing", "cleanup-pending"].includes(
    phase,
  );
  if (input === undefined) return requiresIntent ? false : null;
  if (!input || typeof input !== "object") return false;
  const attempt = input as Record<string, unknown>;
  if (!hasOnlyKeys(attempt, ZIP_ATTEMPT_KEYS) || !isCanonicalTimestamp(attempt.requestedAt)) {
    return false;
  }
  if (
    Date.parse(attempt.requestedAt as string) < Date.parse(ledgerCreatedAt) ||
    Date.parse(attempt.requestedAt as string) > Date.parse(ledgerUpdatedAt)
  ) {
    return false;
  }
  const downloadId = attempt.downloadId;
  if (phase === "zip-intent-persisted") {
    return downloadId === undefined ? { requestedAt: attempt.requestedAt } : false;
  }
  if (
    (phase === "zip-observing" || phase === "cleanup-pending") &&
    typeof downloadId === "number" &&
    Number.isSafeInteger(downloadId) &&
    downloadId >= 0
  ) {
    return { requestedAt: attempt.requestedAt, downloadId };
  }
  return false;
}

function validPhaseState(
  phase: SinglePeriodBundlePhase,
  artifacts: SinglePeriodBundleArtifact[],
): boolean {
  const runningIndex = artifacts.findIndex((artifact) => artifact.status === "running");
  const firstPendingIndex = artifacts.findIndex((artifact) => artifact.status === "pending");
  const boundary =
    runningIndex >= 0 ? runningIndex : firstPendingIndex < 0 ? artifacts.length : firstPendingIndex;
  const collectingProgression = artifacts.every((artifact, index) => {
    if (index < boundary) return artifact.status === "staged" || artifact.status === "unavailable";
    if (index === runningIndex) return artifact.status === "running";
    return artifact.status === "pending";
  });
  const reviewProgression = runningIndex >= 0 && collectingProgression;
  const allTerminal = allArtifactsTerminal({ artifacts } as SinglePeriodBundleLedger);
  if (phase === "artifact-review") return reviewProgression;
  if (phase === "collecting") return collectingProgression;
  return allTerminal;
}

function updateArtifact(
  ledger: SinglePeriodBundleLedger,
  artifactType: FiledReturnsConcreteArtifactType,
  now: Date,
  nextArtifact: SinglePeriodBundleArtifact,
): SinglePeriodBundleLedger | null {
  const index = ledger.artifacts.findIndex((artifact) => artifact.artifactType === artifactType);
  if (index < 0) return null;
  const artifacts = [...ledger.artifacts];
  artifacts[index] = nextArtifact;
  return nextLedger(ledger, now, { artifacts });
}

function nextLedger(
  ledger: SinglePeriodBundleLedger,
  now: Date,
  changes: Partial<Pick<SinglePeriodBundleLedger, "artifacts" | "phase" | "zipDownloadAttempt">>,
): SinglePeriodBundleLedger | null {
  const revision = ledger.revision + 1;
  let updatedAt: string;
  try {
    updatedAt = now.toISOString();
  } catch {
    return null;
  }
  if (
    !Number.isSafeInteger(revision) ||
    revision > 1_000_000 ||
    Date.parse(updatedAt) < Date.parse(ledger.updatedAt)
  ) {
    return null;
  }
  return {
    ...ledger,
    ...changes,
    revision,
    updatedAt,
  };
}

async function transitionStoredLedger(
  expectedLedger: SinglePeriodBundleLedger,
  transition: (ledger: SinglePeriodBundleLedger) => SinglePeriodBundleLedger | null,
): Promise<SinglePeriodBundleLedger | null> {
  return runBundleLedgerCriticalSection(async () => {
    const current = await readSinglePeriodBundleLedgerStorageState();
    if (
      current.state !== "valid" ||
      current.ledger.ledgerId !== expectedLedger.ledgerId ||
      current.ledger.revision !== expectedLedger.revision
    ) {
      return null;
    }
    const next = transition(current.ledger);
    const validNext = next ? parseSinglePeriodBundleLedger(next) : null;
    if (!validNext) return null;
    try {
      await browser.storage.local.set({
        [PACK_LOCAL_STORAGE_KEYS.singlePeriodStaging]: validNext,
      });
      return validNext;
    } catch {
      return null;
    }
  });
}

async function runBundleLedgerCriticalSection<T>(action: () => Promise<T>): Promise<T> {
  const previous = bundleLedgerCriticalSection;
  let release: () => void = () => undefined;
  bundleLedgerCriticalSection = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function optionalArtifactDiagnostic(
  input: { downloadDiagnostic?: unknown },
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
): FiledReturnsDownloadDiagnostic | null {
  if (input.downloadDiagnostic === undefined) return null;
  const artifactScope = { ...scope, artifactType };
  return isValidFiledReturnsDownloadDiagnosticState(input, artifactScope)
    ? (input.downloadDiagnostic as FiledReturnsDownloadDiagnostic)
    : null;
}

function validArtifactDiagnostic(
  input: { downloadDiagnostic?: unknown },
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
): FiledReturnsDownloadDiagnostic | null {
  return optionalArtifactDiagnostic(input, scope, artifactType);
}

function allArtifactsTerminal(ledger: Pick<SinglePeriodBundleLedger, "artifacts">): boolean {
  return ledger.artifacts.every(
    (artifact) => artifact.status === "staged" || artifact.status === "unavailable",
  );
}

function statusSignals(
  status: SinglePeriodBundleArtifactStatus,
  artifactType: FiledReturnsConcreteArtifactType,
): string[] {
  if (status === "staged") {
    return ["single-period-bundle-artifact-staged", `single-period-opfs-staged:${artifactType}`];
  }
  return [`single-period-bundle-artifact-${status}`];
}

function isSupportedBundleScope(input: unknown): input is FiledReturnsDownloadScope {
  if (!input || typeof input !== "object") return false;
  const scope = input as Partial<FiledReturnsDownloadScope>;
  if (!hasOnlyKeys(input as Record<string, unknown>, SCOPE_KEYS)) return false;
  if (!isFiledReturnsReturnType(scope.returnType)) return false;
  if (!isConsecutiveFinancialYear(scope.financialYear) || !isFiledReturnsMonth(scope.period)) {
    return false;
  }
  return (
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType) === "PDF_AND_EXCEL"
  );
}

function parsedArtifactPlan(
  scope: FiledReturnsDownloadScope,
  plan: unknown,
): FiledReturnsConcreteArtifactType[] | null {
  const current = concreteFiledReturnsArtifactTypesForSelection(
    scope.returnType,
    scope.artifactType,
  );
  if (sameStrings(plan, current)) return current;
  return scope.returnType === "GSTR-2B" && sameStrings(plan, ["PDF", "EXCEL"])
    ? ["PDF", "EXCEL"]
    : null;
}

function missingArtifactReason(flowStep: PortalFlowStepResult): string | null {
  return (
    flowStep.safeSignals.find((signal) => MISSING_ARTIFACT_REASONS.has(signal)) ??
    (flowStep.safeSignals.includes("filed-gstr1-excel-no-details-available")
      ? "artifact-filed-gstr1-excel-no-details-available"
      : null)
  );
}

function isMissingReason(value: unknown): value is string {
  return typeof value === "string" && MISSING_ARTIFACT_REASONS.has(value);
}

function bundleSafeMessage(ledger: SinglePeriodBundleLedger): string {
  const missing = ledger.artifacts
    .filter((artifact) => artifact.status === "unavailable")
    .map((artifact) => `${artifact.artifactType} (${artifact.missingReason})`);
  return missing.length === 0
    ? "Pack recovered the durably staged selected-file artifacts."
    : `Pack prepared a partial ZIP; missing ${missing.join(", ")}.`;
}

function isArtifactStatus(input: unknown): input is SinglePeriodBundleArtifactStatus {
  return ["pending", "running", "staged", "unavailable"].includes(String(input));
}

function isBundlePhase(input: unknown): input is SinglePeriodBundlePhase {
  return [
    "collecting",
    "artifact-review",
    "ready-for-zip",
    "zip-intent-persisted",
    "zip-observing",
    "cleanup-pending",
  ].includes(String(input));
}

function sameStrings(input: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(input) &&
    input.length === expected.length &&
    input.every((value, index) => value === expected[index])
  );
}

function createSinglePeriodBundleLedgerId(now: Date): string {
  return createFiledReturnsLedgerId("single-period", now);
}

function recoverableLedgerId(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const ledgerId = (input as { ledgerId?: unknown }).ledgerId;
  return isCanonicalSinglePeriodLedgerId(ledgerId) ? ledgerId : null;
}

function exactLegacySinglePeriodStagingLedgerId(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (!hasOnlyKeys(record, ["ledgerId", "schemaVersion"])) return null;
  return record.schemaVersion === "1.0" && isCanonicalSinglePeriodLedgerId(record.ledgerId)
    ? record.ledgerId
    : null;
}

function isConsecutiveFinancialYear(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const match = /^20(\d{2})-(\d{2})$/.exec(input);
  return Boolean(match && Number(match[2]) === (Number(match[1]) + 1) % 100);
}

function isFiledReturnsMonth(input: unknown): input is FiledReturnsMonth {
  return typeof input === "string" && FILED_RETURNS_MONTHS.includes(input as FiledReturnsMonth);
}

function isCanonicalTimestamp(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 40) return false;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === input;
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

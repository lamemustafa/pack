import { createHash } from "node:crypto";

import {
  isFiledReturnsEndpointClassForArtifact,
  isFiledReturnsEndpointPathPair,
  isPortalClickDownloadPath,
  isTargetBoundPortalClickDownloadPath,
} from "../../src/connectors/gst/filed-returns-download-diagnostic-compatibility.ts";
import {
  concreteFiledReturnsArtifactTypesForSelection,
  supportsFiledReturnsArtifactType,
} from "../../src/connectors/gst/filed-returns-artifacts.ts";
import { LIVE_RUN_SENSITIVE_PATTERNS } from "./live-run-evidence-redaction.ts";
import type {
  LiveRunEvidence,
  LiveRunEvidenceChecks,
  LiveRunEvidenceCounts,
  LiveRunDownloadEvidence,
  LiveRunEvidenceLimitation,
  LiveRunEvidenceRedaction,
  LiveRunEvidenceValidationResult,
} from "./live-run-evidence-types";

export type {
  LiveRunArtifactType,
  LiveRunEvidence,
  LiveRunEvidenceChecks,
  LiveRunEvidenceCounts,
  LiveRunEvidenceLimitation,
  LiveRunEvidenceMediaArtifact,
  LiveRunEvidenceRedaction,
  LiveRunEvidenceValidationResult,
  LiveRunOutcome,
  LiveRunReturnType,
  LiveRunScenario,
} from "./live-run-evidence-types";

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const FINANCIAL_YEAR = /^20\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SUBJECT_ALIAS = /^SUBJECT-[A-Z0-9]{1,2}$/;
const ACTION_ALIAS = /^ACTION-[1-9]\d{0,2}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/;
const GIT_TAG = /^v\d+\.\d+\.\d+(?:-(?:(?:alpha|beta|rc)\.\d+|local))?$/;
const BROWSER_VERSION = /^(?:\d+(?:\.\d+){1,4}|manual-entry-required)$/;
const PERIODS = [
  "FULL_FISCAL_YEAR",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
];
const LIVE_RUN_EVIDENCE_KEYS = [
  "schemaVersion",
  "evidenceId",
  "sourceCommit",
  "gitTag",
  "zipSha256",
  "extensionVersion",
  "browser",
  "profile",
  "subjectAlias",
  "returnType",
  "artifactType",
  "financialYear",
  "period",
  "scenario",
  "startedAt",
  "completedAt",
  "outcome",
  "counts",
  "checks",
  "downloadEvidence",
  "limitations",
  "redaction",
  "mediaArtifacts",
];
const BROWSER_KEYS = ["name", "version"];
const COUNT_KEYS = [
  "eligibleTargets",
  "downloaded",
  "notFiled",
  "manuallyObserved",
  "blocked",
  "failed",
  "duplicates",
];
const CHECK_KEYS = [
  "humanVerifiedAccount",
  "humanVerifiedPeriods",
  "allFilesNonEmpty",
  "serviceWorkerRestartResumeChecked",
  "browserRestartResumeChecked",
  "clearLocalDataChecked",
  "browserSummaryCaptured",
  "unexpectedNetworkDestinations",
];
const MEDIA_ARTIFACT_KEYS = ["kind", "classification", "redactionMethod", "sha256"];
const DOWNLOAD_EVIDENCE_KEYS = [
  "actionId",
  "returnType",
  "artifactType",
  "financialYear",
  "period",
  "endpointClass",
  "downloadPathClass",
  "status",
  "askWhereToSave",
  "filenameCollision",
  "multipleDownloadPrompt",
  "exactZipBuild",
];
const DOWNLOAD_ENDPOINT_CLASSES = [
  "gstr3b-portal-rendered-download",
  "gstr3b-portal-blob-captured-download",
  "gstr1-pdf-portal-rendered-download",
  "gstr1-excel-portal-rendered-download",
  "gstr1-pdf-portal-blob-captured-download",
  "gstr1-excel-portal-blob-captured-download",
  "gstr2b-portal-blob-captured-download",
  "filed-return-portal-rendered-download",
  "unknown",
] as const;
const DOWNLOAD_PATH_CLASSES = [
  "portal-click-https",
  "portal-click-blob",
  "portal-click-data",
  "portal-click-unknown",
  "target-bound-portal-click-blob",
  "captured-portal-request-https",
  "captured-portal-request-blob",
  "captured-portal-request-data",
  "captured-portal-request-unknown",
] as const;
const DOWNLOAD_STATUSES = [
  "downloaded",
  "not-filed",
  "unavailable-on-portal",
  "user-action-required",
  "unsupported",
  "blocked",
  "failed",
] as const;
const LIMITATIONS: LiveRunEvidenceLimitation[] = [
  "clean-profile-not-verified",
  "human-account-match-not-verified",
  "human-period-match-not-verified",
  "file-non-empty-check-not-verified",
  "service-worker-restart-not-verified",
  "browser-restart-not-verified",
  "clear-local-data-not-verified",
  "browser-state-not-captured",
];
const LIMITATION_SET = new Set<string>(LIMITATIONS);

const REQUIRED_TRUE_CHECKS: Array<keyof LiveRunEvidenceChecks> = [
  "humanVerifiedAccount",
  "humanVerifiedPeriods",
  "allFilesNonEmpty",
  "serviceWorkerRestartResumeChecked",
  "browserRestartResumeChecked",
  "clearLocalDataChecked",
  "browserSummaryCaptured",
];

const REDACTION_ASSERTIONS: Array<keyof LiveRunEvidenceRedaction> = [
  "containsGstin",
  "containsPan",
  "containsTaxpayerName",
  "containsFilename",
  "containsPortalUrl",
  "containsLocalPath",
  "containsPdf",
  "containsCookieOrToken",
  "containsPortalHtml",
  "containsScreenshotOrVideo",
];

export function validateLiveRunEvidence(input: unknown): LiveRunEvidenceValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["evidence must be an object"] };

  requireOnlyKeys(input, LIVE_RUN_EVIDENCE_KEYS, "evidence", errors);
  requireExact(input.schemaVersion, 1, "schemaVersion", errors);
  requirePattern(input.sourceCommit, HEX_40, "sourceCommit", errors);
  requirePattern(input.gitTag, GIT_TAG, "gitTag", errors);
  requirePattern(input.zipSha256, HEX_64, "zipSha256", errors);
  requirePattern(input.extensionVersion, SEMVER, "extensionVersion", errors);
  validateBuildIdentity(input, errors);
  validateBrowser(input.browser, errors);
  requireOneOf(input.profile, ["clean-test-profile", "manual-review-required"], "profile", errors);
  requirePattern(input.subjectAlias, SUBJECT_ALIAS, "subjectAlias", errors, {
    message: "subjectAlias must be a neutral SUBJECT-* alias",
  });
  requireOneOf(input.returnType, ["GSTR-3B", "GSTR-1", "GSTR-2B"], "returnType", errors);
  requireOneOf(
    input.artifactType,
    ["PDF", "JSON", "EXCEL", "PDF_AND_EXCEL"],
    "artifactType",
    errors,
  );
  // A standalone JSON selection is acquired by the direct same-origin fetch in
  // filed-returns-download-trigger.ts, whose success flow step carries no
  // downloadDiagnostic at all — for either return type. Nothing the runtime
  // retains can back a passing claim about it, so refuse rather than certify.
  // JSON acquired as part of an all-formats selection is staged and does retain
  // a diagnostic, so those rows stay valid; only the standalone selection is
  // unbackable.
  if (input.artifactType === "JSON" && input.outcome === "pass") {
    errors.push(
      "artifactType JSON cannot record a pass outcome: the standalone JSON path retains no download diagnostic, so no evidence can back it. Record the run as blocked, or capture JSON as part of an all-formats selection.",
    );
  }
  requirePattern(input.financialYear, FINANCIAL_YEAR, "financialYear", errors);
  requireOneOf(input.period, PERIODS, "period", errors);
  requireOneOf(input.scenario, ["single-period", "full-year"], "scenario", errors);
  validateScopeConsistency(input, errors);
  requireIsoTimestamp(input.startedAt, "startedAt", errors);
  requireIsoTimestamp(input.completedAt, "completedAt", errors);
  validateEvidenceId(input, errors);
  validateTimeRange(input.startedAt, input.completedAt, errors);
  requireOneOf(input.outcome, ["pass", "blocked", "failed"], "outcome", errors);
  if (Object.prototype.hasOwnProperty.call(input, "notes")) {
    errors.push("notes is not allowed in shareable evidence");
  }
  if (input.outcome === "pass" && input.profile !== "clean-test-profile") {
    errors.push("pass evidence must use clean-test-profile");
  }
  validateCounts(input.counts, input.outcome, errors);
  validateChecks(input.checks, input.scenario, input.outcome, errors);
  validateDownloadEvidence(input.downloadEvidence, input, errors);
  validateLimitations(input.limitations, input.outcome, errors);
  validateRedaction(input.redaction, errors);
  validateMediaArtifacts(input.mediaArtifacts, errors);
  assertNoSensitiveMarkers(input, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, evidence: input as unknown as LiveRunEvidence };
}

function validateDownloadEvidence(
  input: unknown,
  evidence: Record<string, unknown>,
  errors: string[],
): void {
  if (!Array.isArray(input)) {
    errors.push("downloadEvidence must be an array");
    return;
  }
  const downloadedCount = isRecord(evidence.counts) ? evidence.counts.downloaded : undefined;
  if (evidence.outcome === "pass" && input.length === 0 && downloadedCount !== 0) {
    errors.push("pass evidence must include downloadEvidence");
  }
  validatePassDownloadEvidenceReconciliation(input, evidence, errors);
  input.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`downloadEvidence[${index}] must be an object`);
      return;
    }
    requireOnlyKeys(entry, DOWNLOAD_EVIDENCE_KEYS, `downloadEvidence[${index}]`, errors);
    requirePattern(entry.actionId, ACTION_ALIAS, `downloadEvidence[${index}].actionId`, errors);
    requireOneOf(
      entry.returnType,
      ["GSTR-3B", "GSTR-1", "GSTR-2B"],
      `downloadEvidence[${index}].returnType`,
      errors,
    );
    requireOneOf(
      entry.artifactType,
      ["PDF", "JSON", "EXCEL"],
      `downloadEvidence[${index}].artifactType`,
      errors,
    );
    requirePattern(
      entry.financialYear,
      FINANCIAL_YEAR,
      `downloadEvidence[${index}].financialYear`,
      errors,
    );
    requireOneOf(entry.period, PERIODS, `downloadEvidence[${index}].period`, errors);
    requireOneOf(
      entry.endpointClass,
      DOWNLOAD_ENDPOINT_CLASSES,
      `downloadEvidence[${index}].endpointClass`,
      errors,
    );
    requireOneOf(
      entry.downloadPathClass,
      DOWNLOAD_PATH_CLASSES,
      `downloadEvidence[${index}].downloadPathClass`,
      errors,
    );
    validateDownloadEndpointPathConsistency(entry, evidence, index, errors);
    requireOneOf(entry.status, DOWNLOAD_STATUSES, `downloadEvidence[${index}].status`, errors);
    requireOneOf(
      entry.askWhereToSave,
      ["on", "off", "unknown"],
      `downloadEvidence[${index}].askWhereToSave`,
      errors,
    );
    requireOneOf(
      entry.filenameCollision,
      ["present", "absent", "unknown"],
      `downloadEvidence[${index}].filenameCollision`,
      errors,
    );
    requireOneOf(
      entry.multipleDownloadPrompt,
      ["shown", "not-shown", "unknown"],
      `downloadEvidence[${index}].multipleDownloadPrompt`,
      errors,
    );
    requirePattern(entry.exactZipBuild, HEX_64, `downloadEvidence[${index}].exactZipBuild`, errors);
    if (
      typeof entry.exactZipBuild === "string" &&
      typeof evidence.zipSha256 === "string" &&
      entry.exactZipBuild !== evidence.zipSha256
    ) {
      errors.push(`downloadEvidence[${index}].exactZipBuild must match zipSha256`);
    }
    validateDownloadScopeConsistency(
      entry as Partial<LiveRunDownloadEvidence>,
      evidence,
      index,
      errors,
    );
  });
}

function validatePassDownloadEvidenceReconciliation(
  entries: unknown[],
  evidence: Record<string, unknown>,
  errors: string[],
): void {
  if (evidence.outcome !== "pass" || !isRecord(evidence.counts)) return;
  const downloadedEntries = entries.filter(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry.status === "downloaded",
  );
  const downloadedTargetPeriods = new Set(
    downloadedEntries
      .map((entry) => entry.period)
      .filter((period): period is string => typeof period === "string"),
  );
  if (
    typeof evidence.counts.downloaded === "number" &&
    downloadedTargetPeriods.size !== evidence.counts.downloaded
  ) {
    errors.push("pass evidence must include one unique period per downloaded target");
  }
  const targetIdentities = new Set(
    downloadedEntries.map((entry) => `${String(entry.period)}:${String(entry.artifactType)}`),
  );
  if (targetIdentities.size !== downloadedEntries.length) {
    errors.push("pass evidence cannot duplicate a downloaded period and artifact");
  }
  const actionIds = new Set(downloadedEntries.map((entry) => entry.actionId));
  if (actionIds.size !== downloadedEntries.length) {
    errors.push("pass evidence cannot reuse a downloaded actionId");
  }
  const expectedArtifactTypes = expectedConcreteArtifactTypes(evidence);
  if (
    expectedArtifactTypes.length > 0 &&
    downloadedEntries.some(
      (entry) =>
        typeof entry.artifactType !== "string" ||
        !expectedArtifactTypes.includes(entry.artifactType),
    )
  ) {
    errors.push("pass evidence must not include an artifact outside the selected artifact type");
  }
  const artifactsByPeriod = new Map<string, Set<string>>();
  downloadedEntries.forEach((entry) => {
    if (typeof entry.period !== "string" || typeof entry.artifactType !== "string") return;
    const artifacts = artifactsByPeriod.get(entry.period) ?? new Set<string>();
    artifacts.add(entry.artifactType);
    artifactsByPeriod.set(entry.period, artifacts);
  });
  if (
    expectedArtifactTypes.length > 0 &&
    Array.from(artifactsByPeriod.values()).some((artifacts) =>
      expectedArtifactTypes.some((artifactType) => !artifacts.has(artifactType)),
    )
  ) {
    errors.push(
      `pass evidence must include ${expectedArtifactTypes.join(", ")} for each downloaded period`,
    );
  }
  if (
    entries.some(
      (entry) =>
        isRecord(entry) &&
        ["blocked", "failed", "user-action-required", "unsupported"].includes(String(entry.status)),
    )
  ) {
    errors.push("pass evidence cannot include unresolved downloadEvidence statuses");
  }
}

function validateDownloadEndpointPathConsistency(
  entry: Record<string, unknown>,
  evidence: Record<string, unknown>,
  index: number,
  errors: string[],
): void {
  if (typeof entry.endpointClass !== "string" || typeof entry.downloadPathClass !== "string") {
    return;
  }
  const endpoint = entry.endpointClass;
  const typedEntry = entry as unknown as LiveRunDownloadEvidence;
  validateTargetBoundPortalClickScope(typedEntry, evidence, index, errors);
  if (endpoint === "unknown") {
    if (evidence.outcome === "pass" || entry.status === "downloaded") {
      errors.push(
        `downloadEvidence[${index}].endpointClass cannot be unknown for passed downloads`,
      );
    }
    return;
  }
  if (
    (evidence.outcome === "pass" || entry.status === "downloaded") &&
    isPortalClickDownloadPath(typedEntry.downloadPathClass)
  ) {
    errors.push(`downloadEvidence[${index}] plain portal-click evidence cannot confirm a download`);
  }
  if (!isSupportedLiveRunEvidenceEndpoint(typedEntry)) {
    errors.push(
      `downloadEvidence[${index}].endpointClass does not match returnType and artifactType`,
    );
  }
  if (!isFiledReturnsEndpointPathPair(typedEntry.endpointClass, typedEntry.downloadPathClass)) {
    errors.push(`downloadEvidence[${index}].endpointClass is inconsistent with downloadPathClass`);
  }
}

function isSupportedLiveRunEvidenceEndpoint(entry: LiveRunDownloadEvidence): boolean {
  // Defer entirely to the canonical predicate. The exception that used to sit
  // here accepted `gstr3b-portal-blob-captured-download` for GSTR-3B JSON, a
  // pairing the canonical rule rejects and the runtime never produces: the
  // direct JSON fetch path attaches no diagnostic at all. Evidence for a JSON
  // artifact therefore carries `unknown`, which the canonical predicate already
  // admits. A local exception here could only ever certify something the
  // runtime cannot back.
  return isFiledReturnsEndpointClassForArtifact(
    entry.endpointClass,
    entry.returnType,
    entry.artifactType,
  );
}

function validateTargetBoundPortalClickScope(
  entry: LiveRunDownloadEvidence,
  evidence: Record<string, unknown>,
  index: number,
  errors: string[],
): void {
  if (!isTargetBoundPortalClickDownloadPath(entry.downloadPathClass)) return;
  if (
    evidence.scenario !== "single-period" ||
    evidence.returnType !== "GSTR-3B" ||
    evidence.artifactType !== "PDF" ||
    evidence.period === "FULL_FISCAL_YEAR" ||
    entry.returnType !== "GSTR-3B" ||
    entry.artifactType !== "PDF" ||
    entry.period === "FULL_FISCAL_YEAR" ||
    entry.endpointClass !== "gstr3b-portal-rendered-download"
  ) {
    errors.push(
      `downloadEvidence[${index}].downloadPathClass target-bound-portal-click-blob is only valid for single-period GSTR-3B PDF evidence and cannot represent full-year or staged ZIP work`,
    );
  }
}

function validateDownloadScopeConsistency(
  entry: Partial<LiveRunDownloadEvidence>,
  evidence: Record<string, unknown>,
  index: number,
  errors: string[],
): void {
  if (entry.returnType !== evidence.returnType) {
    errors.push(`downloadEvidence[${index}].returnType must match evidence returnType`);
  }
  if (entry.financialYear !== evidence.financialYear) {
    errors.push(`downloadEvidence[${index}].financialYear must match evidence financialYear`);
  }
  if (evidence.scenario === "single-period" && entry.period !== evidence.period) {
    errors.push(`downloadEvidence[${index}].period must match single-period evidence period`);
  }
  const expectedArtifactTypes = expectedConcreteArtifactTypes(evidence);
  if (
    expectedArtifactTypes.length > 0 &&
    !expectedArtifactTypes.includes(entry.artifactType ?? "")
  ) {
    errors.push(`downloadEvidence[${index}].artifactType must match the selected artifact type`);
  }
}

export function validateLiveRunEvidenceJson(source: string): LiveRunEvidenceValidationResult {
  const errors: string[] = [];
  assertNoSensitiveMarkers(source, errors);
  if (errors.length > 0) return { ok: false, errors };

  try {
    return validateLiveRunEvidence(JSON.parse(source) as unknown);
  } catch {
    return { ok: false, errors: ["evidence JSON is invalid"] };
  }
}

export function computeLiveRunEvidenceDigest(evidence: LiveRunEvidence): string {
  return createHash("sha256").update(stableJson(evidence)).digest("hex");
}

function validateBrowser(input: unknown, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push("browser must be an object");
    return;
  }
  requireOnlyKeys(input, BROWSER_KEYS, "browser", errors);
  requireOneOf(input.name, ["Brave", "Chrome"], "browser.name", errors);
  requirePattern(input.version, BROWSER_VERSION, "browser.version", errors);
}

function validateEvidenceId(input: Record<string, unknown>, errors: string[]): void {
  if (
    typeof input.startedAt !== "string" ||
    typeof input.subjectAlias !== "string" ||
    typeof input.scenario !== "string"
  ) {
    errors.push("evidenceId is invalid");
    return;
  }
  const expected = `pack-live-run-${input.startedAt.slice(0, 10)}-${input.subjectAlias.toLowerCase()}-${input.scenario}`;
  if (input.evidenceId !== expected) errors.push("evidenceId must match the canonical run alias");
}

function validateBuildIdentity(input: Record<string, unknown>, errors: string[]): void {
  if (typeof input.gitTag !== "string" || typeof input.extensionVersion !== "string") return;
  const exactTag = `v${input.extensionVersion}`;
  if (input.gitTag !== exactTag && input.gitTag !== `${exactTag}-local`) {
    errors.push("gitTag must match extensionVersion");
  }
}

function validateScopeConsistency(input: Record<string, unknown>, errors: string[]): void {
  if (
    typeof input.returnType === "string" &&
    typeof input.artifactType === "string" &&
    !supportsFiledReturnsArtifactType(
      input.returnType as LiveRunEvidence["returnType"],
      input.artifactType as LiveRunEvidence["artifactType"],
    )
  ) {
    errors.push("artifactType is not supported for returnType");
  }
  if (input.scenario === "full-year" && input.period !== "FULL_FISCAL_YEAR") {
    errors.push("full-year evidence must use period FULL_FISCAL_YEAR");
  }
  if (input.scenario === "single-period" && input.period === "FULL_FISCAL_YEAR") {
    errors.push("single-period evidence must use a month period");
  }
}

function expectedConcreteArtifactTypes(evidence: Record<string, unknown>): string[] {
  if (
    typeof evidence.returnType !== "string" ||
    typeof evidence.artifactType !== "string" ||
    !["GSTR-3B", "GSTR-1", "GSTR-2B"].includes(evidence.returnType) ||
    !["PDF", "JSON", "EXCEL", "PDF_AND_EXCEL"].includes(evidence.artifactType)
  ) {
    return [];
  }
  return concreteFiledReturnsArtifactTypesForSelection(
    evidence.returnType as LiveRunEvidence["returnType"],
    evidence.artifactType as LiveRunEvidence["artifactType"],
  );
}

function validateCounts(input: unknown, outcome: unknown, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push("counts must be an object");
    return;
  }
  requireOnlyKeys(input, COUNT_KEYS, "counts", errors);
  for (const field of COUNT_KEYS) {
    requireNonNegativeInteger(input[field], `counts.${field}`, errors);
  }
  if (!hasOnlyNumberCounts(input)) return;
  const reconciled = input.downloaded + input.notFiled + input.manuallyObserved;
  const observed = reconciled + input.blocked + input.failed;
  if (outcome === "pass" && reconciled === 0) {
    errors.push("counts must include at least one reconciled target");
  } else if (observed === 0) {
    errors.push("counts must include at least one observed target");
  }
  if (outcome === "pass") {
    if (input.eligibleTargets !== observed) {
      errors.push("counts must reconcile eligible targets");
    }
    if (input.blocked > 0) errors.push("pass evidence cannot include blocked targets");
    if (input.failed > 0) errors.push("pass evidence cannot include failed targets");
    if (input.duplicates > 0) errors.push("pass evidence cannot include duplicate targets");
    if (input.eligibleTargets !== reconciled) {
      errors.push("pass evidence must reconcile every eligible target");
    }
  } else if (observed > input.eligibleTargets) {
    errors.push("counts cannot exceed eligible targets");
  }
}

function validateChecks(
  input: unknown,
  scenario: unknown,
  outcome: unknown,
  errors: string[],
): void {
  if (!isRecord(input)) {
    errors.push("checks must be an object");
    return;
  }
  requireOnlyKeys(input, CHECK_KEYS, "checks", errors);
  const requiredChecks =
    scenario === "full-year"
      ? REQUIRED_TRUE_CHECKS
      : REQUIRED_TRUE_CHECKS.filter(
          (field) =>
            field !== "serviceWorkerRestartResumeChecked" &&
            field !== "browserRestartResumeChecked",
        );
  if (outcome === "pass") {
    for (const field of requiredChecks) {
      if (input[field] !== true) errors.push(`checks.${field} must be true`);
    }
  }
  requireNonNegativeInteger(
    input.unexpectedNetworkDestinations,
    "checks.unexpectedNetworkDestinations",
    errors,
  );
  if (
    outcome === "pass" &&
    typeof input.unexpectedNetworkDestinations === "number" &&
    input.unexpectedNetworkDestinations > 0
  ) {
    errors.push("pass evidence cannot include unexpected network destinations");
  }
}

function validateRedaction(input: unknown, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push("redaction must be an object");
    return;
  }
  requireOnlyKeys(input, REDACTION_ASSERTIONS, "redaction", errors);
  for (const field of REDACTION_ASSERTIONS) {
    if (input[field] !== false) errors.push(`redaction.${field} must be false`);
  }
}

function validateTimeRange(startedAt: unknown, completedAt: unknown, errors: string[]): void {
  if (typeof startedAt !== "string" || typeof completedAt !== "string") return;
  const startedAtMs = Date.parse(startedAt);
  const completedAtMs = Date.parse(completedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) return;
  if (completedAtMs <= startedAtMs) errors.push("completedAt must be after startedAt");
}

function validateLimitations(input: unknown, outcome: unknown, errors: string[]): void {
  if (input === undefined) return;
  if (!Array.isArray(input)) {
    errors.push("limitations must be an array");
    return;
  }
  if (outcome === "pass" && input.length > 0) {
    errors.push("pass evidence cannot include limitations");
  }
  const seen = new Set<string>();
  input.forEach((limitation, index) => {
    if (typeof limitation !== "string" || !LIMITATION_SET.has(limitation)) {
      errors.push(`limitations[${index}] must be one of ${LIMITATIONS.join(", ")}`);
      return;
    }
    if (seen.has(limitation)) {
      errors.push(`limitations[${index}] duplicates ${limitation}`);
      return;
    }
    seen.add(limitation);
  });
}

function validateMediaArtifacts(input: unknown, errors: string[]): void {
  if (input === undefined) return;
  if (!Array.isArray(input)) {
    errors.push("mediaArtifacts must be an array");
    return;
  }
  input.forEach((artifact, index) => {
    if (!isRecord(artifact)) {
      errors.push(`mediaArtifacts[${index}] must be an object`);
      return;
    }
    requireOnlyKeys(artifact, MEDIA_ARTIFACT_KEYS, `mediaArtifacts[${index}]`, errors);
    requireOneOf(
      artifact.kind,
      ["screenshot", "screen-recording", "other"],
      `mediaArtifacts[${index}].kind`,
      errors,
    );
    if (artifact.classification === "public-redacted-live-portal") {
      errors.push(`mediaArtifacts[${index}].classification cannot publish live portal captures`);
    }
    requireOneOf(
      artifact.classification,
      ["private-debug-only", "synthetic-public-demo", "public-redacted-live-portal"],
      `mediaArtifacts[${index}].classification`,
      errors,
    );
    requireOneOf(
      artifact.redactionMethod,
      ["not-published", "synthetic-only", "manual-blur"],
      `mediaArtifacts[${index}].redactionMethod`,
      errors,
    );
    if (
      (artifact.classification === "private-debug-only" &&
        artifact.redactionMethod !== "not-published") ||
      (artifact.classification === "synthetic-public-demo" &&
        artifact.redactionMethod !== "synthetic-only")
    ) {
      errors.push(`mediaArtifacts[${index}].redactionMethod must match classification`);
    }
    if (artifact.sha256 !== undefined) {
      requirePattern(artifact.sha256, HEX_64, `mediaArtifacts[${index}].sha256`, errors);
    }
  });
}

function assertNoSensitiveMarkers(input: unknown, errors: string[]): void {
  const evidenceText = typeof input === "string" ? input : JSON.stringify(input);
  for (const { id, pattern } of LIVE_RUN_SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(evidenceText)) errors.push(`sensitive marker ${id} found in evidence`);
  }
}

function requireExact(
  value: unknown,
  expected: number | string | boolean,
  field: string,
  errors: string[],
): void {
  if (value !== expected) errors.push(`${field} must be ${String(expected)}`);
}

function requirePattern(
  value: unknown,
  pattern: RegExp,
  field: string,
  errors: string[],
  options: { message?: string } = {},
): void {
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(options.message ?? `${field} is invalid`);
  }
}

function requireIsoTimestamp(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) {
    errors.push(`${field} is invalid`);
    return;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    errors.push(`${field} is invalid`);
    return;
  }
  const canonical = new Date(parsed).toISOString();
  if (value.includes(".")) {
    if (value !== canonical) errors.push(`${field} is invalid`);
    return;
  }
  if (value !== canonical.replace(".000Z", "Z")) errors.push(`${field} is invalid`);
}

function requireOneOf(
  value: unknown,
  allowed: readonly string[],
  field: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${field} must be one of ${allowed.join(", ")}`);
  }
}

function requireNonNegativeInteger(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    errors.push(`${field} must be a non-negative integer`);
  }
}

function requireOnlyKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  field: string,
  errors: string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push(`${field}.${key} is not allowed`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasOnlyNumberCounts(
  input: Record<string, unknown>,
): input is Record<keyof LiveRunEvidenceCounts, number> {
  return (
    typeof input.downloaded === "number" &&
    typeof input.eligibleTargets === "number" &&
    typeof input.notFiled === "number" &&
    typeof input.manuallyObserved === "number" &&
    typeof input.blocked === "number" &&
    typeof input.failed === "number" &&
    typeof input.duplicates === "number"
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

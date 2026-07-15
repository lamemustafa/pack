import { createHash } from "node:crypto";

import { LIVE_RUN_SENSITIVE_PATTERNS } from "./live-run-evidence-redaction";
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
const SUBJECT_ALIAS = /^SUBJECT-[A-Z0-9]{1,12}$/;
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
  "gstr3b-getgenpdf",
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
  "extension-direct-https",
  "extension-direct-blob",
  "extension-direct-data",
  "extension-direct-unknown",
  "portal-click-https",
  "portal-click-blob",
  "portal-click-data",
  "portal-click-unknown",
  "portal-click-after-direct-fallback-https",
  "portal-click-after-direct-fallback-blob",
  "portal-click-after-direct-fallback-data",
  "portal-click-after-direct-fallback-unknown",
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
  requireBoundedString(input.evidenceId, "evidenceId", errors, 8, 120);
  requirePattern(input.sourceCommit, HEX_40, "sourceCommit", errors);
  requireBoundedString(input.gitTag, "gitTag", errors, 2, 40);
  requirePattern(input.zipSha256, HEX_64, "zipSha256", errors);
  requireBoundedString(input.extensionVersion, "extensionVersion", errors, 1, 32);
  validateBrowser(input.browser, errors);
  requireBoundedString(input.profile, "profile", errors, 1, 80);
  requirePattern(input.subjectAlias, SUBJECT_ALIAS, "subjectAlias", errors, {
    message: "subjectAlias must be a neutral SUBJECT-* alias",
  });
  requireOneOf(input.returnType, ["GSTR-3B", "GSTR-1", "GSTR-2B"], "returnType", errors);
  requireOneOf(input.artifactType, ["PDF", "EXCEL", "PDF_AND_EXCEL"], "artifactType", errors);
  requirePattern(input.financialYear, FINANCIAL_YEAR, "financialYear", errors);
  requireOneOf(input.period, PERIODS, "period", errors);
  requireOneOf(input.scenario, ["single-period", "full-year"], "scenario", errors);
  validateScopeConsistency(input, errors);
  requireIsoTimestamp(input.startedAt, "startedAt", errors);
  requireIsoTimestamp(input.completedAt, "completedAt", errors);
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
  if (evidence.outcome === "pass" && input.length === 0) {
    errors.push("pass evidence must include downloadEvidence");
  }
  validatePassDownloadEvidenceReconciliation(input, evidence, errors);
  input.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`downloadEvidence[${index}] must be an object`);
      return;
    }
    requireOnlyKeys(entry, DOWNLOAD_EVIDENCE_KEYS, `downloadEvidence[${index}]`, errors);
    requireBoundedString(entry.actionId, `downloadEvidence[${index}].actionId`, errors, 4, 120);
    requireOneOf(
      entry.returnType,
      ["GSTR-3B", "GSTR-1", "GSTR-2B"],
      `downloadEvidence[${index}].returnType`,
      errors,
    );
    requireOneOf(
      entry.artifactType,
      ["PDF", "EXCEL"],
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
    downloadedTargetPeriods.size < evidence.counts.downloaded
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
  const path = entry.downloadPathClass;
  if (endpoint === "unknown") {
    if (evidence.outcome === "pass" || entry.status === "downloaded") {
      errors.push(
        `downloadEvidence[${index}].endpointClass cannot be unknown for passed downloads`,
      );
    }
    return;
  }
  const matchesRuntimePath =
    (endpoint === "gstr3b-getgenpdf" && path.startsWith("extension-direct-")) ||
    (endpoint.includes("portal-blob-captured-download") &&
      path.startsWith("captured-portal-request-")) ||
    (endpoint.includes("portal-rendered-download") && path.startsWith("portal-click-"));
  if (!matchesRuntimePath) {
    errors.push(`downloadEvidence[${index}].endpointClass is inconsistent with downloadPathClass`);
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
  if (evidence.artifactType === "PDF" && entry.artifactType !== "PDF") {
    errors.push(`downloadEvidence[${index}].artifactType must match PDF evidence`);
  }
  if (evidence.artifactType === "EXCEL" && entry.artifactType !== "EXCEL") {
    errors.push(`downloadEvidence[${index}].artifactType must match EXCEL evidence`);
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
  requireBoundedString(input.name, "browser.name", errors, 1, 40);
  requireBoundedString(input.version, "browser.version", errors, 1, 80);
}

function validateScopeConsistency(input: Record<string, unknown>, errors: string[]): void {
  if (input.returnType === "GSTR-3B" && input.artifactType !== "PDF") {
    errors.push("GSTR-3B evidence must use artifactType PDF");
  }
  if (input.scenario === "full-year" && input.period !== "FULL_FISCAL_YEAR") {
    errors.push("full-year evidence must use period FULL_FISCAL_YEAR");
  }
  if (input.scenario === "single-period" && input.period === "FULL_FISCAL_YEAR") {
    errors.push("single-period evidence must use a month period");
  }
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
    requireBoundedString(
      artifact.redactionMethod,
      `mediaArtifacts[${index}].redactionMethod`,
      errors,
      1,
      80,
    );
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

function requireBoundedString(
  value: unknown,
  field: string,
  errors: string[],
  minLength: number,
  maxLength: number,
): void {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
    errors.push(`${field} must be a string between ${minLength} and ${maxLength} characters`);
  }
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

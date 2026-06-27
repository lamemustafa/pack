import { createHash } from "node:crypto";

import { LIVE_RUN_SENSITIVE_PATTERNS } from "./live-run-evidence-redaction";
import type {
  LiveRunEvidence,
  LiveRunEvidenceChecks,
  LiveRunEvidenceCounts,
  LiveRunEvidenceRedaction,
  LiveRunEvidenceValidationResult,
} from "./live-run-evidence-types";

export type {
  LiveRunEvidence,
  LiveRunEvidenceChecks,
  LiveRunEvidenceCounts,
  LiveRunEvidenceMediaArtifact,
  LiveRunEvidenceRedaction,
  LiveRunEvidenceValidationResult,
  LiveRunOutcome,
  LiveRunScenario,
} from "./live-run-evidence-types";

const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SUBJECT_ALIAS = /^SUBJECT-[A-Z0-9]{1,12}$/;
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
  "scenario",
  "startedAt",
  "completedAt",
  "outcome",
  "counts",
  "checks",
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
  "unexpectedNetworkDestinations",
];
const MEDIA_ARTIFACT_KEYS = ["kind", "classification", "redactionMethod", "sha256"];

const REQUIRED_TRUE_CHECKS: Array<keyof LiveRunEvidenceChecks> = [
  "humanVerifiedAccount",
  "humanVerifiedPeriods",
  "allFilesNonEmpty",
  "serviceWorkerRestartResumeChecked",
  "browserRestartResumeChecked",
  "clearLocalDataChecked",
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
  requireOneOf(input.scenario, ["single-period", "full-year"], "scenario", errors);
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
  validateRedaction(input.redaction, errors);
  validateMediaArtifacts(input.mediaArtifacts, errors);
  assertNoSensitiveMarkers(input, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, evidence: input as unknown as LiveRunEvidence };
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
  if (input.eligibleTargets !== observed) {
    errors.push("counts must reconcile eligible targets");
  }
  if (outcome === "pass") {
    if (input.blocked > 0) errors.push("pass evidence cannot include blocked targets");
    if (input.failed > 0) errors.push("pass evidence cannot include failed targets");
    if (input.duplicates > 0) errors.push("pass evidence cannot include duplicate targets");
    if (input.eligibleTargets !== reconciled) {
      errors.push("pass evidence must reconcile every eligible target");
    }
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

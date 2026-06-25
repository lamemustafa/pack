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
const SUBJECT_ALIAS = /^SUBJECT-[A-Z0-9_-]+$/;

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
  requirePattern(input.startedAt, ISO_TIMESTAMP, "startedAt", errors);
  requirePattern(input.completedAt, ISO_TIMESTAMP, "completedAt", errors);
  validateTimeRange(input.startedAt, input.completedAt, errors);
  requireOneOf(input.outcome, ["pass", "blocked", "failed"], "outcome", errors);
  if (input.outcome === "pass" && input.profile !== "clean-test-profile") {
    errors.push("pass evidence must use clean-test-profile");
  }
  validateCounts(input.counts, input.outcome, input.scenario, errors);
  validateChecks(input.checks, input.scenario, input.outcome, errors);
  validateRedaction(input.redaction, errors);
  validateMediaArtifacts(input.mediaArtifacts, errors);
  assertNoSensitiveMarkers(input, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, evidence: input as unknown as LiveRunEvidence };
}

export function computeLiveRunEvidenceDigest(evidence: LiveRunEvidence): string {
  return createHash("sha256").update(stableJson(evidence)).digest("hex");
}

function validateBrowser(input: unknown, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push("browser must be an object");
    return;
  }
  requireBoundedString(input.name, "browser.name", errors, 1, 40);
  requireBoundedString(input.version, "browser.version", errors, 1, 80);
}

function validateCounts(
  input: unknown,
  outcome: unknown,
  scenario: unknown,
  errors: string[],
): void {
  if (!isRecord(input)) {
    errors.push("counts must be an object");
    return;
  }
  for (const field of [
    "eligibleTargets",
    "downloaded",
    "notFiled",
    "manuallyObserved",
    "blocked",
    "failed",
    "duplicates",
  ]) {
    requireNonNegativeInteger(input[field], `counts.${field}`, errors);
  }
  if (!hasOnlyNumberCounts(input)) return;
  const reconciled = input.downloaded + input.notFiled + input.manuallyObserved;
  if (reconciled === 0) errors.push("counts must include at least one reconciled target");
  if (outcome === "pass") {
    if (input.blocked > 0) errors.push("pass evidence cannot include blocked targets");
    if (input.failed > 0) errors.push("pass evidence cannot include failed targets");
    if (input.duplicates > 0) errors.push("pass evidence cannot include duplicate targets");
    if (scenario === "full-year" && input.eligibleTargets !== reconciled) {
      errors.push("full-year pass evidence must reconcile every eligible target");
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
  const requiredChecks =
    scenario === "full-year"
      ? REQUIRED_TRUE_CHECKS
      : REQUIRED_TRUE_CHECKS.filter(
          (field) =>
            field !== "serviceWorkerRestartResumeChecked" &&
            field !== "browserRestartResumeChecked",
        );
  for (const field of requiredChecks) {
    if (input[field] !== true) errors.push(`checks.${field} must be true`);
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
  const evidenceText = JSON.stringify(input);
  for (const { id, pattern } of LIVE_RUN_SENSITIVE_PATTERNS) {
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

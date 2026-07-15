#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";

const RETURN_TYPES = ["GSTR-3B", "GSTR-1", "GSTR-2B"];
const ARTIFACT_TYPES = ["PDF", "EXCEL", "PDF_AND_EXCEL"];
const MONTHS = [
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
const PERIODS = ["FULL_FISCAL_YEAR", ...MONTHS];
const OUTCOMES = ["pass", "blocked", "failed"];
const LIMITATIONS = [
  "clean-profile-not-verified",
  "human-account-match-not-verified",
  "human-period-match-not-verified",
  "file-non-empty-check-not-verified",
  "service-worker-restart-not-verified",
  "browser-restart-not-verified",
  "clear-local-data-not-verified",
  "browser-state-not-captured",
];
const BOOLEAN_FLAGS = new Set([
  "human-verified-account",
  "human-verified-periods",
  "all-files-non-empty",
  "service-worker-restart-resume-checked",
  "browser-restart-resume-checked",
  "clear-local-data-checked",
  "browser-summary-captured",
]);
const REPEATABLE_VALUE_FLAGS = new Set(["limitation"]);

try {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const returnType = requiredOneOf(options, "return-type", RETURN_TYPES);
  const artifactType = requiredOneOf(options, "artifact-type", ARTIFACT_TYPES);
  const financialYear = requiredPattern(options, "financial-year", /^20\d{2}-\d{2}$/);
  const period = requiredOneOf(options, "period", PERIODS);
  const scenario =
    options.scenario ?? (period === "FULL_FISCAL_YEAR" ? "full-year" : "single-period");
  requireOneOfValue(scenario, ["single-period", "full-year"], "scenario");
  const outcome = options.outcome ?? "blocked";
  requireOneOfValue(outcome, OUTCOMES, "outcome");

  if (returnType === "GSTR-3B" && artifactType !== "PDF") {
    throw new Error("GSTR-3B evidence must use --artifact-type PDF.");
  }
  if (scenario === "full-year" && period !== "FULL_FISCAL_YEAR") {
    throw new Error("Full-year evidence must use --period FULL_FISCAL_YEAR.");
  }
  if (scenario === "single-period" && period === "FULL_FISCAL_YEAR") {
    throw new Error("Single-period evidence must use a month period.");
  }

  const eligibleTargets = numberOption(
    options,
    "eligible-targets",
    scenario === "full-year" ? 12 : 1,
  );
  const counts = defaultCounts(outcome, eligibleTargets);
  for (const field of [
    "downloaded",
    "not-filed",
    "manually-observed",
    "blocked",
    "failed",
    "duplicates",
  ]) {
    const key = field;
    if (options[key] !== undefined) counts[toCamelCountKey(key)] = numberOption(options, key, 0);
  }

  const checks = defaultChecks(outcome, scenario);
  for (const flag of BOOLEAN_FLAGS) {
    if (options[flag] === true) checks[toCamelCheckKey(flag)] = true;
  }
  checks.unexpectedNetworkDestinations = numberOption(
    options,
    "unexpected-network-destinations",
    0,
  );

  if (outcome === "pass") {
    requirePassAssertion(options, "clean-test-profile");
    for (const flag of [
      "human-verified-account",
      "human-verified-periods",
      "all-files-non-empty",
      "clear-local-data-checked",
      "browser-summary-captured",
    ]) {
      requirePassAssertion(options, flag);
    }
    if (scenario === "full-year") {
      requirePassAssertion(options, "service-worker-restart-resume-checked");
      requirePassAssertion(options, "browser-restart-resume-checked");
    }
  }
  const limitations = collectLimitations(options, {
    checks,
    outcome,
    profile:
      options["clean-test-profile"] === true ? "clean-test-profile" : "manual-review-required",
    scenario,
  });

  const startedAt = options["started-at"] ?? new Date().toISOString();
  const completedAt =
    options["completed-at"] ?? new Date(Date.parse(startedAt) + 1_000).toISOString();
  const zipSha256 = options["zip-sha256"] ?? readChromeZipSha256(packageJson.version);

  const evidence = {
    schemaVersion: 1,
    evidenceId:
      options["evidence-id"] ??
      `pack-live-run-${new Date(startedAt).toISOString().slice(0, 10)}-${String(
        options["subject-alias"] ?? "SUBJECT-A",
      ).toLowerCase()}-${scenario}`,
    sourceCommit: options["source-commit"] ?? git(["rev-parse", "HEAD"]),
    gitTag: options["git-tag"] ?? `v${packageJson.version}-local`,
    zipSha256,
    extensionVersion: options["extension-version"] ?? packageJson.version,
    browser: {
      name: options.browser ?? "Brave",
      version: options["browser-version"] ?? "manual-entry-required",
    },
    profile:
      options["clean-test-profile"] === true ? "clean-test-profile" : "manual-review-required",
    subjectAlias: options["subject-alias"] ?? "SUBJECT-A",
    returnType,
    artifactType,
    financialYear,
    period,
    scenario,
    startedAt,
    completedAt,
    outcome,
    counts: {
      eligibleTargets,
      ...counts,
    },
    checks,
    downloadEvidence: Array.from(
      { length: outcome === "pass" ? Math.max(1, counts.downloaded) : 1 },
      (_, index) => ({
        actionId: `manual-entry-required-${index + 1}`,
        returnType,
        artifactType: artifactType === "PDF_AND_EXCEL" ? "PDF" : artifactType,
        financialYear,
        period: period === "FULL_FISCAL_YEAR" ? MONTHS[index % MONTHS.length] : period,
        endpointClass: defaultEndpointClass(returnType, artifactType),
        downloadPathClass: defaultDownloadPathClass(returnType),
        status: outcome === "pass" ? "downloaded" : "user-action-required",
        askWhereToSave: options["ask-where-to-save"] ?? "unknown",
        filenameCollision: options["filename-collision"] ?? "unknown",
        multipleDownloadPrompt: options["multiple-download-prompt"] ?? "unknown",
        exactZipBuild: zipSha256,
      }),
    ),
    ...(limitations.length > 0 ? { limitations } : {}),
    redaction: {
      containsGstin: false,
      containsPan: false,
      containsTaxpayerName: false,
      containsFilename: false,
      containsPortalUrl: false,
      containsLocalPath: false,
      containsPdf: false,
      containsCookieOrToken: false,
      containsPortalHtml: false,
      containsScreenshotOrVideo: false,
    },
  };

  const output = `${JSON.stringify(evidence, null, 2)}\n`;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output);
  } else {
    process.stdout.write(output);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Pack live evidence template failed: ${message}`);
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (BOOLEAN_FLAGS.has(key) || key === "clean-test-profile") {
      parsed[key] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    if (REPEATABLE_VALUE_FLAGS.has(key)) {
      parsed[key] = [...(parsed[key] ?? []), value];
      index += 1;
      continue;
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requiredOneOf(input, key, allowed) {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Missing --${key}.`);
  requireOneOfValue(value, allowed, key);
  return value;
}

function requireOneOfValue(value, allowed, key) {
  if (!allowed.includes(value)) throw new Error(`--${key} must be one of ${allowed.join(", ")}.`);
}

function requiredPattern(input, key, pattern) {
  const value = input[key];
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid --${key}.`);
  return value;
}

function numberOption(input, key, fallback) {
  if (input[key] === undefined) return fallback;
  const parsed = Number(input[key]);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${key} must be a non-negative integer.`);
  }
  return parsed;
}

function defaultCounts(outcome, eligibleTargets) {
  if (outcome === "pass") {
    return {
      downloaded: eligibleTargets,
      notFiled: 0,
      manuallyObserved: 0,
      blocked: 0,
      failed: 0,
      duplicates: 0,
    };
  }
  return {
    downloaded: 0,
    notFiled: 0,
    manuallyObserved: 0,
    blocked: outcome === "blocked" ? eligibleTargets : 0,
    failed: outcome === "failed" ? eligibleTargets : 0,
    duplicates: 0,
  };
}

function defaultChecks(outcome, scenario) {
  const passed = outcome === "pass";
  return {
    humanVerifiedAccount: passed,
    humanVerifiedPeriods: passed,
    allFilesNonEmpty: passed,
    serviceWorkerRestartResumeChecked: passed && scenario === "full-year",
    browserRestartResumeChecked: passed && scenario === "full-year",
    clearLocalDataChecked: passed,
    browserSummaryCaptured: passed,
    unexpectedNetworkDestinations: 0,
  };
}

function requirePassAssertion(input, key) {
  if (input[key] !== true) throw new Error(`Pass evidence requires --${key}.`);
}

function collectLimitations(input, { checks, outcome, profile, scenario }) {
  const explicitLimitations = input.limitation ?? [];
  if (!Array.isArray(explicitLimitations)) throw new Error("--limitation must be repeatable.");
  for (const limitation of explicitLimitations) {
    requireOneOfValue(limitation, LIMITATIONS, "limitation");
  }
  const limitations = new Set(explicitLimitations);
  if (outcome !== "pass") {
    if (profile !== "clean-test-profile") limitations.add("clean-profile-not-verified");
    if (!checks.humanVerifiedAccount) limitations.add("human-account-match-not-verified");
    if (!checks.humanVerifiedPeriods) limitations.add("human-period-match-not-verified");
    if (!checks.allFilesNonEmpty) limitations.add("file-non-empty-check-not-verified");
    if (scenario === "full-year" && !checks.serviceWorkerRestartResumeChecked) {
      limitations.add("service-worker-restart-not-verified");
    }
    if (scenario === "full-year" && !checks.browserRestartResumeChecked) {
      limitations.add("browser-restart-not-verified");
    }
    if (!checks.clearLocalDataChecked) limitations.add("clear-local-data-not-verified");
    if (!checks.browserSummaryCaptured) limitations.add("browser-state-not-captured");
  }
  if (outcome === "pass" && limitations.size > 0) {
    throw new Error("Pass evidence cannot include --limitation.");
  }
  return [...limitations].sort();
}

function defaultEndpointClass(returnType, artifactType) {
  if (returnType === "GSTR-3B") return "gstr3b-getgenpdf";
  if (returnType === "GSTR-1" && artifactType === "EXCEL") {
    return "gstr1-excel-portal-blob-captured-download";
  }
  if (returnType === "GSTR-1") return "gstr1-pdf-portal-blob-captured-download";
  if (returnType === "GSTR-2B") return "gstr2b-portal-blob-captured-download";
  return "unknown";
}

function defaultDownloadPathClass(returnType) {
  return returnType === "GSTR-3B" ? "extension-direct-unknown" : "captured-portal-request-unknown";
}

function toCamelCountKey(key) {
  if (key === "not-filed") return "notFiled";
  if (key === "manually-observed") return "manuallyObserved";
  return key;
}

function toCamelCheckKey(key) {
  return key.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function readChromeZipSha256(version) {
  const outputDir = path.join(process.cwd(), ".output");
  const zipFiles = readdirSync(outputDir).filter(
    (entry) => entry.endsWith(".zip") && entry.includes("chrome"),
  );
  const versionedZipFiles = zipFiles.filter((entry) => entry.includes(`-${version}-chrome`));
  const candidates = versionedZipFiles.length > 0 ? versionedZipFiles : zipFiles;
  if (candidates.length !== 1) {
    throw new Error(
      `Pass --zip-sha256 or keep exactly one Chrome ZIP for version ${version} under .output.`,
    );
  }
  return execFileSync("shasum", ["-a", "256", path.join(outputDir, candidates[0])], {
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/)[0];
}

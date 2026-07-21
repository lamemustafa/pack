import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateLiveRunEvidence } from "../../scripts/lib/live-run-evidence";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "create-live-run-evidence-template.mjs");
const stableArgs = [
  "--source-commit",
  "0123456789abcdef0123456789abcdef01234567",
  "--zip-sha256",
  "b".repeat(64),
  "--started-at",
  "2026-07-03T08:00:00.000Z",
  "--completed-at",
  "2026-07-03T08:30:00.000Z",
  "--browser-version",
  "1.80.122",
];

describe("live evidence template generator", () => {
  it("creates a valid blocked GSTR-1 full-year PDF+Excel evidence template", () => {
    const evidence = runTemplate([
      "--return-type",
      "GSTR-1",
      "--artifact-type",
      "PDF_AND_EXCEL",
      "--financial-year",
      "2025-26",
      "--period",
      "FULL_FISCAL_YEAR",
      "--subject-alias",
      "SUBJECT-A",
      ...stableArgs,
    ]);

    expect(validateLiveRunEvidence(evidence)).toMatchObject({ ok: true });
    expect(evidence).toMatchObject({
      artifactType: "PDF_AND_EXCEL",
      counts: {
        blocked: 12,
        eligibleTargets: 12,
      },
      financialYear: "2025-26",
      period: "FULL_FISCAL_YEAR",
      returnType: "GSTR-1",
      scenario: "full-year",
    });
    expect(evidence.limitations).toEqual([
      "browser-restart-not-verified",
      "browser-state-not-captured",
      "clean-profile-not-verified",
      "clear-local-data-not-verified",
      "file-non-empty-check-not-verified",
      "human-account-match-not-verified",
      "human-period-match-not-verified",
      "service-worker-restart-not-verified",
    ]);
  });

  it("requires explicit restart and profile assertions for pass full-year evidence", () => {
    const failed = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--return-type",
        "GSTR-1",
        "--artifact-type",
        "PDF_AND_EXCEL",
        "--financial-year",
        "2025-26",
        "--period",
        "FULL_FISCAL_YEAR",
        "--outcome",
        "pass",
        ...stableArgs,
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
      },
    );

    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("Pass evidence requires --clean-test-profile");

    const evidence = runTemplate([
      "--return-type",
      "GSTR-1",
      "--artifact-type",
      "PDF_AND_EXCEL",
      "--financial-year",
      "2025-26",
      "--period",
      "FULL_FISCAL_YEAR",
      "--outcome",
      "pass",
      "--clean-test-profile",
      "--human-verified-account",
      "--human-verified-periods",
      "--all-files-non-empty",
      "--service-worker-restart-resume-checked",
      "--browser-restart-resume-checked",
      "--clear-local-data-checked",
      "--browser-summary-captured",
      ...stableArgs,
    ]);

    expect(validateLiveRunEvidence(evidence)).toMatchObject({ ok: true });
    expect(evidence.checks).toMatchObject({
      browserRestartResumeChecked: true,
      browserSummaryCaptured: true,
      serviceWorkerRestartResumeChecked: true,
    });
    expect(evidence.profile).toBe("clean-test-profile");
    expect(evidence.limitations).toBeUndefined();
    expect(evidence.downloadEvidence).toHaveLength(24);
    const artifactsByPeriod = new Map<string, Set<string>>();
    for (const row of evidence.downloadEvidence) {
      const artifacts = artifactsByPeriod.get(row.period) ?? new Set<string>();
      artifacts.add(row.artifactType);
      artifactsByPeriod.set(row.period, artifacts);
    }
    expect(artifactsByPeriod.size).toBe(12);
    for (const artifacts of artifactsByPeriod.values()) {
      expect([...artifacts].sort()).toEqual(["EXCEL", "PDF"]);
    }
    expect(
      new Set(evidence.downloadEvidence.map((row: { actionId: string }) => row.actionId)).size,
    ).toBe(24);
  });

  it("writes target-bound no-record rows when a passing run has no artifact", () => {
    const evidence = runTemplate([
      "--return-type",
      "GSTR-1",
      "--artifact-type",
      "PDF",
      "--financial-year",
      "2025-26",
      "--period",
      "FULL_FISCAL_YEAR",
      "--outcome",
      "pass",
      "--downloaded",
      "0",
      "--no-filed-record-observed",
      "12",
      "--clean-test-profile",
      "--human-verified-account",
      "--human-verified-periods",
      "--all-files-non-empty",
      "--service-worker-restart-resume-checked",
      "--browser-restart-resume-checked",
      "--clear-local-data-checked",
      "--browser-summary-captured",
      ...stableArgs,
    ]);

    expect(validateLiveRunEvidence(evidence)).toMatchObject({ ok: true });
    expect(evidence.counts).toMatchObject({ downloaded: 0, noFiledRecordObserved: 12 });
    expect(evidence.downloadEvidence).toHaveLength(12);
    expect(evidence.downloadEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactType: "NONE",
          status: "no-filed-record-observed",
        }),
      ]),
    );
  });

  it("defaults GSTR-3B evidence to the capture-first runtime path", () => {
    const evidence = runTemplate([
      "--return-type",
      "GSTR-3B",
      "--artifact-type",
      "PDF",
      "--financial-year",
      "2025-26",
      "--period",
      "April",
      "--outcome",
      "pass",
      "--clean-test-profile",
      "--human-verified-account",
      "--human-verified-periods",
      "--all-files-non-empty",
      "--clear-local-data-checked",
      "--browser-summary-captured",
      ...stableArgs,
    ]);

    expect(validateLiveRunEvidence(evidence)).toMatchObject({ ok: true });
    expect(evidence.downloadEvidence).toEqual([
      expect.objectContaining({
        endpointClass: "gstr3b-portal-blob-captured-download",
        downloadPathClass: "captured-portal-request-unknown",
        status: "downloaded",
      }),
    ]);
  });

  it("creates an immutable contiguous same-FY range template", () => {
    const evidence = runTemplate([
      "--return-type",
      "GSTR-2B",
      "--artifact-type",
      "PDF_AND_EXCEL",
      "--financial-year",
      "2025-26",
      "--period",
      "CUSTOM_SAME_FY_RANGE",
      "--range-start",
      "July",
      "--range-end",
      "September",
      "--subject-alias",
      "SUBJECT-A",
      ...stableArgs,
    ]);

    expect(validateLiveRunEvidence(evidence)).toMatchObject({ ok: true });
    expect(evidence).toMatchObject({
      period: "CUSTOM_SAME_FY_RANGE",
      scenario: "custom-range",
      selectedPeriods: ["July", "August", "September"],
      counts: { eligibleTargets: 3, blocked: 3 },
    });
  });

  it("rejects a non-contiguous or full-year custom range request", () => {
    const reversed = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--return-type",
        "GSTR-1",
        "--artifact-type",
        "PDF",
        "--financial-year",
        "2025-26",
        "--period",
        "CUSTOM_SAME_FY_RANGE",
        "--range-start",
        "September",
        "--range-end",
        "July",
        ...stableArgs,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );
    const fullYear = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--return-type",
        "GSTR-1",
        "--artifact-type",
        "PDF",
        "--financial-year",
        "2025-26",
        "--period",
        "CUSTOM_SAME_FY_RANGE",
        "--range-start",
        "April",
        "--range-end",
        "March",
        ...stableArgs,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );

    expect(reversed.status).toBe(1);
    expect(reversed.stderr).toContain("--range-end must be after --range-start");
    expect(fullYear.status).toBe(1);
    expect(fullYear.stderr).toContain("A full financial year must use --period FULL_FISCAL_YEAR.");
  });

  it("accepts explicit limitation codes for blocked evidence only", () => {
    const evidence = runTemplate([
      "--return-type",
      "GSTR-1",
      "--artifact-type",
      "PDF_AND_EXCEL",
      "--financial-year",
      "2025-26",
      "--period",
      "FULL_FISCAL_YEAR",
      "--limitation",
      "browser-state-not-captured",
      ...stableArgs,
    ]);
    const failed = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--return-type",
        "GSTR-1",
        "--artifact-type",
        "PDF_AND_EXCEL",
        "--financial-year",
        "2025-26",
        "--period",
        "FULL_FISCAL_YEAR",
        "--outcome",
        "pass",
        "--clean-test-profile",
        "--human-verified-account",
        "--human-verified-periods",
        "--all-files-non-empty",
        "--service-worker-restart-resume-checked",
        "--browser-restart-resume-checked",
        "--clear-local-data-checked",
        "--browser-summary-captured",
        "--limitation",
        "browser-state-not-captured",
        ...stableArgs,
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
      },
    );

    expect(validateLiveRunEvidence(evidence)).toMatchObject({ ok: true });
    expect(evidence.limitations).toContain("browser-state-not-captured");
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("Pass evidence cannot include --limitation.");
  });

  it("writes a valid evidence file when --output is provided", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "pack-evidence-template-"));
    const outputPath = path.join(tempDir, "redacted-live-run.json");
    try {
      execFileSync(
        process.execPath,
        [
          scriptPath,
          "--return-type",
          "GSTR-1",
          "--artifact-type",
          "PDF_AND_EXCEL",
          "--financial-year",
          "2025-26",
          "--period",
          "FULL_FISCAL_YEAR",
          "--output",
          outputPath,
          ...stableArgs,
        ],
        {
          cwd: rootDir,
          encoding: "utf8",
        },
      );
      const evidence = JSON.parse(readFileSync(outputPath, "utf8"));

      expect(validateLiveRunEvidence(evidence)).toMatchObject({ ok: true });
      expect(evidence.returnType).toBe("GSTR-1");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

function runTemplate(args: string[]) {
  return JSON.parse(
    execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: rootDir,
      encoding: "utf8",
    }),
  );
}

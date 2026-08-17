import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FILED_RETURNS_ARTIFACT_TYPES,
  supportsFiledReturnsArtifactType,
} from "../../src/connectors/gst/filed-returns-artifacts";
import { FILED_RETURNS_RETURN_TYPES } from "../../src/connectors/gst/filed-returns-return-types";

const rootDir = process.cwd();
const matrixStart = "<!-- BEGIN: full-year-recovery-matrix -->";
const matrixEnd = "<!-- END: full-year-recovery-matrix -->";
const matrixColumns = [
  "Return type",
  "Artifact type",
  "Service-worker restart",
  "Browser restart",
  "Interrupted download",
  "Cancellation/discard and cleanup",
  "Retained checkpoint; browser record unavailable",
  "Expected fail-closed / not applicable",
];
const observationPattern =
  /^(pass|fail|fail-closed-as-expected|not-applicable|not-yet-run); date: (\d{4}-\d{2}-\d{2}|not-recorded)(?:; reason: ([a-z]+(?:-[a-z]+)*))?$/;
const reasonCategories = new Set([
  "not-recorded",
  "selection-not-acquisition-capable",
  "recovery-scenario-not-applicable",
  "expected-fail-closed-boundary",
]);
const recoveryMatrixCheckboxPattern =
  /^- \[( |x)\] The authorised live full fiscal year recovery matrix below is complete:/m;

describe("publication readiness recovery matrix", () => {
  it("keeps status-closeout consumers aligned to the canonical listing version", async () => {
    const [readiness, listing, dashboardCloseout] = await Promise.all([
      readPublicationReadiness(),
      readFile(path.join(rootDir, "docs", "chrome-web-store", "listing.md"), "utf8"),
      readFile(path.join(rootDir, "docs", "chrome-web-store", "dashboard-closeout.md"), "utf8"),
    ]);
    const submittedVersion = listing.match(/^- Submitted package: `(v\d+\.\d+\.\d+)`/m)?.[1];

    expect(submittedVersion).toBeTruthy();
    const expectedVersion = submittedVersion?.slice(1);
    expect(readiness).toContain(`expected_version=${expectedVersion}`);
    expect(
      [...dashboardCloseout.matchAll(/^expected_version=(\d+\.\d+\.\d+)$/gm)].map(
        (match) => match[1],
      ),
    ).toEqual([expectedVersion, expectedVersion]);
  });

  it("tracks every canonical offered return and artifact selection once", async () => {
    assertCanonicalSelections(matrixRows(await readRecoveryMatrix()));
  });

  it("rejects every unexpected data row instead of filtering it out", async () => {
    const matrix = await readRecoveryMatrix();
    const unfilled = "not-yet-run; date: not-recorded";
    const unexpectedRow = [
      "Notes",
      "unexpected",
      unfilled,
      unfilled,
      unfilled,
      unfilled,
      unfilled,
      `${unfilled}; reason: not-recorded`,
    ];
    const matrixWithUnexpectedRow = `${matrix.trimEnd()}\n| ${unexpectedRow.join(" | ")} |\n`;

    expect(() => assertCanonicalSelections(matrixRows(matrixWithUnexpectedRow))).toThrow();
  });

  it("keeps every observation fillable, dated, and reasoned when required", async () => {
    const matrix = await readRecoveryMatrix();

    for (const [, , ...observations] of matrixRows(matrix)) {
      expect(observations).toHaveLength(6);

      for (const [index, observation] of observations.entries()) {
        validateObservation(observation, index === observations.length - 1);
      }
    }
  });

  it("accepts only closed reason categories", () => {
    expect(() =>
      validateObservation(
        "not-applicable; date: 2026-08-17; reason: recovery-scenario-not-applicable",
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validateObservation("not-applicable; date: 2026-08-17; reason: free-text", false),
    ).toThrow();
  });

  it.each(["2026-99-99", "2026-02-29", "2026-04-31"])(
    "rejects the non-calendar date %s",
    (date) => {
      expect(() => validateObservation(`pass; date: ${date}`, false)).toThrow();
    },
  );

  it("cannot mark the recovery gate complete while any observation is unfilled", async () => {
    const readiness = await readPublicationReadiness();
    const checkbox = readiness.match(recoveryMatrixCheckboxPattern);

    expect(checkbox).not.toBeNull();
    if (checkbox?.[1] !== "x") return;

    for (const [, , ...observations] of matrixRows(recoveryMatrix(readiness))) {
      for (const observation of observations) {
        expect(observation).not.toContain("not-yet-run");
        expect(observation).not.toContain("not-recorded");
      }
    }
  });
});

async function readRecoveryMatrix(): Promise<string> {
  return recoveryMatrix(await readPublicationReadiness());
}

async function readPublicationReadiness(): Promise<string> {
  return readFile(path.join(rootDir, "docs", "PUBLICATION_READINESS.md"), "utf8");
}

function recoveryMatrix(readiness: string): string {
  const start = readiness.indexOf(matrixStart);
  const end = readiness.indexOf(matrixEnd);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return readiness.slice(start + matrixStart.length, end);
}

function matrixRows(matrix: string): string[][] {
  const lines = matrix
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  expect(lines.every((line) => line.startsWith("|") && line.endsWith("|"))).toBe(true);
  expect(lines.length).toBeGreaterThanOrEqual(3);

  const [header, separator, ...dataRows] = lines.map(parseMatrixRow);
  expect(header).toEqual(matrixColumns);
  expect(separator).toHaveLength(matrixColumns.length);
  expect(separator?.every((cell) => /^:?-{3,}:?$/.test(cell))).toBe(true);

  for (const row of dataRows) expect(row).toHaveLength(matrixColumns.length);
  return dataRows;
}

function parseMatrixRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function assertCanonicalSelections(rows: string[][]): void {
  const documentedSelections = rows.map(([returnType, artifactType]) =>
    [returnType, artifactType].join(" | "),
  );
  const offeredSelections = FILED_RETURNS_RETURN_TYPES.flatMap((returnType) =>
    FILED_RETURNS_ARTIFACT_TYPES.filter((artifactType) =>
      supportsFiledReturnsArtifactType(returnType, artifactType),
    ).map((artifactType) => [returnType, artifactType].join(" | ")),
  );

  expect(documentedSelections).toEqual(offeredSelections);
  expect(new Set(documentedSelections).size).toBe(documentedSelections.length);
}

function validateObservation(observation: string, expectationColumn: boolean): void {
  const parsed = observation.match(observationPattern);
  expect(parsed, "matrix cell has an invalid observation format").not.toBeNull();
  if (!parsed) return;

  const [, state, date, reason] = parsed;
  if (state === "not-yet-run") {
    expect(date).toBe("not-recorded");
    if (reason !== undefined) expect(reason).toBe("not-recorded");
  } else {
    expect(isCanonicalCalendarDate(date ?? "")).toBe(true);
    expect(reason).not.toBe("not-recorded");
  }

  if (reason !== undefined) expect(reasonCategories.has(reason)).toBe(true);
  if (state === "pass" || state === "fail") expect(reason).toBeUndefined();
  if (state === "fail-closed-as-expected" || state === "not-applicable") {
    expect(reason).toBeTruthy();
  }
  if (expectationColumn) {
    expect(["fail-closed-as-expected", "not-applicable", "not-yet-run"]).toContain(state);
    expect(reason).toBeTruthy();
  }
}

function isCanonicalCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

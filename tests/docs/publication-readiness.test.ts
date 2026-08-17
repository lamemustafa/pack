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
const legendStart = "<!-- BEGIN: full-year-recovery-cell-legend -->";
const legendEnd = "<!-- END: full-year-recovery-cell-legend -->";
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
  /^([a-z]+(?:-[a-z]+)*); date: ([^;\s]+)(?:; reason: ([a-z]+(?:-[a-z]+)*))?$/;
type DateConstraint = "not-recorded" | "recorded-not-future";
type ColumnConstraint = "any" | "expectation-only" | "scenario-only";
interface ObservationCellRule {
  columnConstraint: ColumnConstraint;
  completionEligible: boolean;
  dateConstraint: DateConstraint;
  reasons: readonly (string | undefined)[];
  state: string;
}
const observationCellRules: readonly ObservationCellRule[] = [
  {
    columnConstraint: "scenario-only",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    reasons: [undefined],
    state: "pass",
  },
  {
    columnConstraint: "scenario-only",
    completionEligible: false,
    dateConstraint: "recorded-not-future",
    reasons: [undefined],
    state: "fail",
  },
  {
    columnConstraint: "any",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    reasons: ["expected-fail-closed-boundary"],
    state: "fail-closed-as-expected",
  },
  {
    columnConstraint: "scenario-only",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    reasons: ["recovery-scenario-not-applicable"],
    state: "not-applicable",
  },
  {
    columnConstraint: "expectation-only",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    reasons: ["selection-not-acquisition-capable"],
    state: "not-applicable",
  },
  {
    columnConstraint: "scenario-only",
    completionEligible: false,
    dateConstraint: "not-recorded",
    reasons: [undefined],
    state: "not-yet-run",
  },
  {
    columnConstraint: "expectation-only",
    completionEligible: false,
    dateConstraint: "not-recorded",
    reasons: ["not-recorded"],
    state: "not-yet-run",
  },
];
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

  it("renders the matrix legend from the canonical whole-cell rules", async () => {
    const readiness = await readPublicationReadiness();
    expect(markedSection(readiness, legendStart, legendEnd).trim()).toBe(
      renderObservationCellLegend(),
    );
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

  it.each([
    "not-applicable; date: 2026-08-17; reason: expected-fail-closed-boundary",
    "fail-closed-as-expected; date: 2026-08-17; reason: recovery-scenario-not-applicable",
    "fail-closed-as-expected; date: 2026-08-17; reason: selection-not-acquisition-capable",
  ])("rejects a reason assigned to the wrong state: %s", (observation) => {
    expect(() => validateObservation(observation, false)).toThrow();
  });

  it("accepts today and past dates but rejects future evidence", () => {
    expect(() => validateObservation(`pass; date: ${utcDateOffset(-1)}`, false)).not.toThrow();
    expect(() => validateObservation(`pass; date: ${utcDateOffset(0)}`, false)).not.toThrow();
    expect(() => validateObservation(`pass; date: ${utcDateOffset(1)}`, false)).toThrow();
  });

  it("allows date not-recorded only for the not-yet-run placeholder", () => {
    expect(() => validateObservation("not-yet-run; date: not-recorded", false)).not.toThrow();
    expect(() => validateObservation("pass; date: not-recorded", false)).toThrow();
    expect(() => validateObservation(`not-yet-run; date: ${utcDateOffset(0)}`, false)).toThrow();
  });

  it("rejects a combination absent from the whole-cell table", () => {
    expect(() => validateObservation(`manual-review; date: ${utcDateOffset(0)}`, false)).toThrow();
  });

  it.each([
    ["not-applicable; date: 2026-08-17; reason: recovery-scenario-not-applicable", true],
    ["not-applicable; date: 2026-08-17; reason: selection-not-acquisition-capable", false],
  ])("rejects a reason in the wrong column: %s", (observation, expectationColumn) => {
    expect(() => validateObservation(observation, expectationColumn)).toThrow();
  });

  it.each(["2026-99-99", "2026-02-29", "2026-04-31"])(
    "rejects the non-calendar date %s",
    (date) => {
      expect(() => validateObservation(`pass; date: ${date}`, false)).toThrow();
    },
  );

  it("cannot mark the recovery gate complete while any observation is unfilled", async () => {
    const readiness = await readPublicationReadiness();
    assertRecoveryGate(readiness);
  });

  it("cannot mark the recovery gate complete when any filled observation failed", async () => {
    const today = utcDateOffset(0);
    const completed = fillRecoveryMatrix(await readPublicationReadiness()).replace(
      `pass; date: ${today}`,
      `fail; date: ${today}`,
    );

    expect(() => assertRecoveryGate(completed)).toThrow();
  });

  it("accepts a checked matrix only when every cell is completion-eligible", async () => {
    const completed = fillRecoveryMatrix(await readPublicationReadiness());
    expect(() => assertRecoveryGate(completed)).not.toThrow();
  });
});

function assertRecoveryGate(readiness: string): void {
  const checkbox = readiness.match(recoveryMatrixCheckboxPattern);

  expect(checkbox).not.toBeNull();
  if (checkbox?.[1] !== "x") return;

  for (const [, , ...observations] of matrixRows(recoveryMatrix(readiness))) {
    for (const [index, observation] of observations.entries()) {
      const rule = validateObservation(observation, index === observations.length - 1);
      expect(rule.completionEligible, "matrix completion requires an eligible cell state").toBe(
        true,
      );
    }
  }
}

function fillRecoveryMatrix(readiness: string): string {
  const today = utcDateOffset(0);
  return readiness
    .replace(
      recoveryMatrixCheckboxPattern,
      "- [x] The authorised live full fiscal year recovery matrix below is complete:",
    )
    .replaceAll(
      "not-yet-run; date: not-recorded; reason: not-recorded",
      `not-applicable; date: ${today}; reason: selection-not-acquisition-capable`,
    )
    .replaceAll("not-yet-run; date: not-recorded", `pass; date: ${today}`);
}

async function readRecoveryMatrix(): Promise<string> {
  return recoveryMatrix(await readPublicationReadiness());
}

async function readPublicationReadiness(): Promise<string> {
  return readFile(path.join(rootDir, "docs", "PUBLICATION_READINESS.md"), "utf8");
}

function recoveryMatrix(readiness: string): string {
  return markedSection(readiness, matrixStart, matrixEnd);
}

function markedSection(document: string, startMarker: string, endMarker: string): string {
  const start = document.indexOf(startMarker);
  const end = document.indexOf(endMarker);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return document.slice(start + startMarker.length, end);
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

function validateObservation(observation: string, expectationColumn: boolean): ObservationCellRule {
  const parsed = observation.match(observationPattern);
  expect(parsed, "matrix cell has an invalid observation format").not.toBeNull();
  if (!parsed) throw new Error("matrix cell has an invalid observation format");

  const [, state, date, reason] = parsed;
  const rule = observationCellRules.find(
    (candidate) =>
      candidate.state === state &&
      candidate.reasons.includes(reason) &&
      dateMatchesConstraint(date ?? "", candidate.dateConstraint) &&
      columnMatchesConstraint(expectationColumn, candidate.columnConstraint),
  );
  expect(rule, "matrix cell combination is not allowed").toBeDefined();
  return rule as ObservationCellRule;
}

function isCanonicalCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function dateMatchesConstraint(value: string, constraint: DateConstraint): boolean {
  if (constraint === "not-recorded") return value === "not-recorded";
  return isCanonicalCalendarDate(value) && value <= utcDateOffset(0);
}

function columnMatchesConstraint(
  expectationColumn: boolean,
  constraint: ColumnConstraint,
): boolean {
  if (constraint === "any") return true;
  return expectationColumn === (constraint === "expectation-only");
}

function utcDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function renderObservationCellLegend(): string {
  const header = ["State", "Date constraint", "Reason", "Allowed column", "Completion-eligible"];
  const rows = observationCellRules.map((rule) => {
    const date =
      rule.dateConstraint === "not-recorded"
        ? "`not-recorded`"
        : "valid `YYYY-MM-DD`, today or earlier in UTC";
    const reasons = rule.reasons
      .map((reason) => (reason === undefined ? "none" : `\`${reason}\``))
      .join(" or ");
    const column =
      rule.columnConstraint === "any"
        ? "any observation column"
        : rule.columnConstraint === "expectation-only"
          ? "final expectation column"
          : "scenario columns";
    return [`\`${rule.state}\``, date, reasons, column, rule.completionEligible ? "yes" : "no"];
  });
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const renderRow = (row: readonly string[]) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ")} |`;
  return [
    renderRow(header),
    renderRow(widths.map((width) => "-".repeat(width))),
    ...rows.map(renderRow),
  ].join("\n");
}

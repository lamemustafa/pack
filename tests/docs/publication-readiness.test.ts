import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FILED_RETURNS_ARTIFACT_TYPES,
  isFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "../../src/connectors/gst/filed-returns-artifacts";
import {
  FILED_RETURNS_RETURN_TYPES,
  isFiledReturnsReturnType,
  supportsFullFiscalYearFiledReturnsRun,
} from "../../src/connectors/gst/filed-returns-return-types";

const rootDir = process.cwd();
const capabilityStart = "<!-- BEGIN: full-year-capability-matrix -->";
const capabilityEnd = "<!-- END: full-year-capability-matrix -->";
const targetStart = "<!-- BEGIN: full-year-target-recovery-matrix -->";
const targetEnd = "<!-- END: full-year-target-recovery-matrix -->";
const matrixStart = "<!-- BEGIN: full-year-run-recovery-matrix -->";
const matrixEnd = "<!-- END: full-year-run-recovery-matrix -->";
const legendStart = "<!-- BEGIN: full-year-recovery-cell-legend -->";
const legendEnd = "<!-- END: full-year-recovery-cell-legend -->";
const storeChecklistStart = "## Chrome Web Store Checklist";
const storeChecklistEnd = "## Suggested Store Copy";
// One row per selection: what Pack can acquire. Derived, so it cannot drift.
const capabilityColumns = ["Return type", "Artifact type", "Expected fail-closed / not applicable"];
// One row per target *shape*: how a restart can leave a target. Recovery code does
// not branch on return type, so a per-selection row here is the same observation
// repeated rather than new evidence.
// Per selection, because these scenarios exercise per-selection code:
// `acquireFiledReturnArtifact` dispatches on return type, and
// `scoreFiledReturnDownloadCandidate` branches GSTR-3B / non-GSTR-3B Excel /
// descriptor. Evidence from one selection does not transfer to another.
const targetColumns = [
  "Return type",
  "Artifact type",
  "Interrupted download",
  "Retained checkpoint; browser record unavailable",
];
// Per plan shape, because these exercise the ledger and its phases rather than
// any one target's acquisition. What varies is whether a restart can land inside
// a target.
const matrixColumns = [
  "Plan shape",
  "Service-worker restart",
  "Browser restart",
  "Cancellation/discard and cleanup",
  "Workbook and ZIP export phase",
];
const PLAN_SHAPES = ["single-artifact-plan", "bundled-artifact-plan"] as const;
const observationPattern =
  /^([a-z]+(?:-[a-z]+)*); date: ([^;\s]+)(?:; reason: ([a-z]+(?:-[a-z]+)*))?$/;
type DateConstraint = "not-recorded" | "recorded-not-future";
type ColumnConstraint = "any" | "expectation-only" | "scenario-only";
type RowCapability = "acquisition-capable" | "not-acquisition-capable";
type RowCapabilityConstraint = "any" | RowCapability;
interface ObservationCellRule {
  columnConstraint: ColumnConstraint;
  completionEligible: boolean;
  dateConstraint: DateConstraint;
  recordedRowCapability?: RowCapability;
  reasons: readonly (string | undefined)[];
  rowCapabilityConstraint: RowCapabilityConstraint;
  state: string;
}
const observationCellRules: readonly ObservationCellRule[] = [
  {
    columnConstraint: "scenario-only",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    reasons: [undefined],
    rowCapabilityConstraint: "any",
    state: "pass",
  },
  {
    columnConstraint: "scenario-only",
    completionEligible: false,
    dateConstraint: "recorded-not-future",
    reasons: [undefined],
    rowCapabilityConstraint: "any",
    state: "fail",
  },
  {
    columnConstraint: "scenario-only",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    reasons: ["expected-fail-closed-boundary"],
    rowCapabilityConstraint: "any",
    state: "fail-closed-as-expected",
  },
  {
    columnConstraint: "expectation-only",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    recordedRowCapability: "acquisition-capable",
    reasons: ["expected-fail-closed-boundary"],
    rowCapabilityConstraint: "acquisition-capable",
    state: "fail-closed-as-expected",
  },
  {
    columnConstraint: "scenario-only",
    completionEligible: false,
    dateConstraint: "recorded-not-future",
    reasons: ["recovery-scenario-not-applicable"],
    rowCapabilityConstraint: "acquisition-capable",
    state: "not-applicable",
  },
  {
    columnConstraint: "scenario-only",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    reasons: ["recovery-scenario-not-applicable"],
    rowCapabilityConstraint: "not-acquisition-capable",
    state: "not-applicable",
  },
  {
    columnConstraint: "expectation-only",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    recordedRowCapability: "not-acquisition-capable",
    reasons: ["selection-not-acquisition-capable"],
    rowCapabilityConstraint: "not-acquisition-capable",
    state: "not-applicable",
  },
  {
    columnConstraint: "scenario-only",
    completionEligible: false,
    dateConstraint: "not-recorded",
    reasons: [undefined],
    rowCapabilityConstraint: "any",
    state: "not-yet-run",
  },
  {
    columnConstraint: "expectation-only",
    completionEligible: false,
    dateConstraint: "not-recorded",
    reasons: ["not-recorded"],
    rowCapabilityConstraint: "any",
    state: "not-yet-run",
  },
];
const recoveryMatrixCheckboxPattern =
  /^- \[( |x)\] The authorised live full fiscal year capability, target recovery, and run/m;
const storeChecklistEvidenceTokenPattern =
  /`(?:\.github\/|docs\/|scripts\/|src\/|tests\/|wxt\.config\.ts)[^`]*`|\b20\d{2}-\d{2}-\d{2}\b|\b(?:GitHub Actions run|[Ww]orkflow run|Run) `\d{8,}`/;

describe("publication readiness recovery matrix", () => {
  it("keeps status-closeout consumers aligned to the canonical listing version", async () => {
    const [readiness, listing, dashboardCloseout] = await Promise.all([
      readPublicationReadiness(),
      readFile(path.join(rootDir, "docs", "chrome-web-store", "listing.md"), "utf8"),
      readFile(path.join(rootDir, "docs", "chrome-web-store", "dashboard-closeout.md"), "utf8"),
    ]);
    // The closeout must track whichever package the dashboard work is ABOUT.
    // While one is in review that is the submitted package, and once nothing is
    // pending it is the published one -- so a submitted entry, when present,
    // wins. Keying only on the published version let a new submission sit
    // unvalidated while the assertions passed against the older live build.
    const submittedVersion = listing.match(/^- Submitted package: `(v\d+\.\d+\.\d+)`/m)?.[1];
    const publishedVersion = listing.match(/^- Published package: `(v\d+\.\d+\.\d+)`/m)?.[1];
    const canonicalVersion = submittedVersion ?? publishedVersion;

    expect(canonicalVersion, "listing.md must name a submitted or published package").toBeTruthy();
    const expectedVersion = canonicalVersion?.slice(1);
    expect(
      readiness.includes(`expected_version=${expectedVersion}`),
      "publication readiness must use the canonical package version",
    ).toBe(true);
    expect(
      [...dashboardCloseout.matchAll(/^expected_version=(\d+\.\d+\.\d+)$/gm)].map(
        (match) => match[1],
      ),
    ).toEqual([expectedVersion, expectedVersion]);
  });

  it("tracks every canonical offered return and artifact selection once", async () => {
    assertCanonicalSelections(matrixRows(await readCapabilityMatrix(), capabilityColumns));
  });

  // The reduction from one row per selection to one row per shape is only honest
  // if every selection still maps to a documented shape. This is the assertion
  // that makes it a derivation rather than a hand-picked subset.
  // The target recovery matrix must carry the same canonical selections as the
  // capability matrix. Without this, a selection can be dropped from recovery
  // evidence while the capability table still lists it -- which is precisely the
  // "one run stands as evidence for paths it never entered" defect.
  it("tracks every canonical offered selection in the target recovery matrix too", async () => {
    assertCanonicalSelections(matrixRows(await readTargetRecoveryMatrix(), targetColumns));
  });

  it("covers every offered selection with exactly one run plan shape", async () => {
    assertCanonicalRecoveryShapes(matrixRows(await readRecoveryMatrix()));
  });

  it("requires every checked Store item to carry a recorded evidence token", async () => {
    const checkedItems = checklistItems(
      markedSection(await readPublicationReadiness(), storeChecklistStart, storeChecklistEnd),
    ).filter((item) => item.checked);

    expect(
      checkedItems.length,
      "Store checklist must contain checked evidence items",
    ).toBeGreaterThan(0);
    for (const [index, item] of checkedItems.entries()) {
      expect(
        storeChecklistEvidenceTokenPattern.test(item.text),
        `checked Store item ${index + 1} must carry a source, run, or dated evidence token`,
      ).toBe(true);
    }
  });

  it("renders the matrix legend from the canonical whole-cell rules", async () => {
    const readiness = await readPublicationReadiness();
    expect(markedSection(readiness, legendStart, legendEnd).trim()).toBe(
      renderObservationCellLegend(),
    );
  });

  it("rejects every unexpected data row instead of filtering it out", async () => {
    const capability = await readCapabilityMatrix();
    const unfilled = "not-yet-run; date: not-recorded";
    const unexpectedRow = ["Notes", "unexpected", `${unfilled}; reason: not-recorded`];
    const withUnexpectedRow = `${capability.trimEnd()}\n| ${unexpectedRow.join(" | ")} |\n`;

    expect(() =>
      assertCanonicalSelections(matrixRows(withUnexpectedRow, capabilityColumns)),
    ).toThrow();

    const recovery = await readRecoveryMatrix();
    const withUnexpectedShape = `${recovery.trimEnd()}\n| invented-shape | ${[unfilled, unfilled, unfilled, unfilled, unfilled].join(" | ")} |\n`;

    expect(() => assertCanonicalRecoveryShapes(matrixRows(withUnexpectedShape))).toThrow();
  });

  it("keeps every observation fillable, dated, and reasoned when required", async () => {
    for (const [returnType = "", artifactType = "", ...observations] of matrixRows(
      await readCapabilityMatrix(),
      capabilityColumns,
    )) {
      expect(observations.length, "capability row must have one observation cell").toBe(1);
      validateObservation(
        observations[0] ?? "",
        true,
        deriveRowCapability(returnType, artifactType),
      );
    }

    for (const [returnType = "", artifactType = "", ...observations] of matrixRows(
      await readTargetRecoveryMatrix(),
      targetColumns,
    )) {
      expect(observations.length, "target recovery row must have two observation cells").toBe(2);
      // Per-selection scenarios still carry the row's derived capability: a
      // selection Pack cannot acquire has no download to interrupt.
      const rowCapability = deriveRowCapability(returnType, artifactType);
      for (const observation of observations) {
        validateObservation(observation, false, rowCapability);
      }
    }

    for (const [, ...observations] of matrixRows(await readRecoveryMatrix())) {
      expect(observations.length, "run recovery row must have four observation cells").toBe(4);
      // Run rows describe a plan shape, not a selection: only acquisition-capable
      // selections reach a run at all.
      for (const observation of observations) {
        validateObservation(observation, false, "acquisition-capable");
      }
    }
  });

  it.each([
    "not-applicable; date: 2026-08-17; reason: expected-fail-closed-boundary",
    "fail-closed-as-expected; date: 2026-08-17; reason: recovery-scenario-not-applicable",
    "fail-closed-as-expected; date: 2026-08-17; reason: selection-not-acquisition-capable",
  ])("rejects a reason assigned to the wrong state: %s", (observation) => {
    expect(() => validateObservation(observation, false, "acquisition-capable")).toThrow();
  });

  it("accepts today and past dates but rejects future evidence", () => {
    expect(() =>
      validateObservation(`pass; date: ${utcDateOffset(-1)}`, false, "acquisition-capable"),
    ).not.toThrow();
    expect(() =>
      validateObservation(`pass; date: ${utcDateOffset(0)}`, false, "acquisition-capable"),
    ).not.toThrow();
    expect(() =>
      validateObservation(`pass; date: ${utcDateOffset(1)}`, false, "acquisition-capable"),
    ).toThrow();
  });

  it("allows date not-recorded only for the not-yet-run placeholder", () => {
    expect(() =>
      validateObservation("not-yet-run; date: not-recorded", false, "acquisition-capable"),
    ).not.toThrow();
    expect(() =>
      validateObservation("pass; date: not-recorded", false, "acquisition-capable"),
    ).toThrow();
    expect(() =>
      validateObservation(`not-yet-run; date: ${utcDateOffset(0)}`, false, "acquisition-capable"),
    ).toThrow();
  });

  it("rejects a combination absent from the whole-cell table", () => {
    expect(() =>
      validateObservation(`manual-review; date: ${utcDateOffset(0)}`, false, "acquisition-capable"),
    ).toThrow();
  });

  it.each([
    [
      "not-applicable; date: 2026-08-17; reason: recovery-scenario-not-applicable",
      true,
      "acquisition-capable" as const,
    ],
    [
      "not-applicable; date: 2026-08-17; reason: selection-not-acquisition-capable",
      false,
      "not-acquisition-capable" as const,
    ],
  ])(
    "rejects a reason in the wrong column: %s",
    (observation, expectationColumn, rowCapability) => {
      expect(() => validateObservation(observation, expectationColumn, rowCapability)).toThrow();
    },
  );

  it.each(["2026-99-99", "2026-02-29", "2026-04-31"])(
    "rejects the non-calendar date %s",
    (date) => {
      expect(() =>
        validateObservation(`pass; date: ${date}`, false, "acquisition-capable"),
      ).toThrow();
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

  it("cannot complete an acquisition-capable row with every scenario not applicable", async () => {
    const today = utcDateOffset(0);
    let completed = fillRecoveryMatrix(await readPublicationReadiness());

    for (let scenario = 0; scenario < 5; scenario += 1) {
      completed = completed.replace(
        `pass; date: ${today}`,
        `not-applicable; date: ${today}; reason: recovery-scenario-not-applicable`,
      );
    }

    expect(() => assertRecoveryGate(completed)).toThrow();
  });

  it("allows a canonically non-capable selection to complete through its expected path", () => {
    const today = utcDateOffset(0);
    const expectation = `not-applicable; date: ${today}; reason: selection-not-acquisition-capable`;

    expect(() => assertCapabilityRowComplete(["GSTR-1", "JSON", expectation])).not.toThrow();
  });

  it("rejects a recorded capability claim that contradicts the derived value", () => {
    const today = utcDateOffset(0);
    const expectation = `not-applicable; date: ${today}; reason: selection-not-acquisition-capable`;

    expect(() => assertCapabilityRowComplete(["GSTR-3B", "PDF", expectation])).toThrow(
      "matrix row capability mismatch: derived acquisition-capable; recorded not-acquisition-capable",
    );
  });

  // A recovery row records a shape, so it must not be gated on a selection's
  // capability -- and it must still refuse an ineligible observation.
  it("requires every recovery scenario cell to be completion-eligible", () => {
    const today = utcDateOffset(0);

    expect(() =>
      assertRecoveryRowComplete([
        "single-artifact-plan",
        ...Array<string>(4).fill(`pass; date: ${today}`),
      ]),
    ).not.toThrow();
    expect(() =>
      assertRecoveryRowComplete([
        "bundled-artifact-plan",
        `fail; date: ${today}`,
        ...Array<string>(3).fill(`pass; date: ${today}`),
      ]),
    ).toThrow();
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

  // Both tables gate the same checkbox: a complete capability record with an
  // unobserved recovery shape is not evidence of a recoverable release.
  for (const row of matrixRows(capabilityMatrix(readiness), capabilityColumns)) {
    assertCapabilityRowComplete(row);
  }
  for (const row of matrixRows(targetRecoveryMatrix(readiness), targetColumns)) {
    assertTargetRecoveryRowComplete(row);
  }
  for (const row of matrixRows(recoveryMatrix(readiness))) assertRecoveryRowComplete(row);
}

function assertTargetRecoveryRowComplete(row: string[]): void {
  const [returnType = "", artifactType = "", ...observations] = row;
  expect(observations.length, "target recovery row must have two observation cells").toBe(2);
  const rowCapability = deriveRowCapability(returnType, artifactType);

  for (const observation of observations) {
    const rule = validateObservation(observation, false, rowCapability);
    expect(rule.completionEligible, "matrix completion requires an eligible cell state").toBe(true);
  }
}

function assertCapabilityRowComplete(row: string[]): void {
  const [returnType = "", artifactType = "", ...observations] = row;
  expect(observations.length, "capability row must have one observation cell").toBe(1);
  const rule = validateObservation(
    observations[0] ?? "",
    true,
    deriveRowCapability(returnType, artifactType),
  );
  expect(rule.completionEligible, "matrix completion requires an eligible cell state").toBe(true);
}

function assertRecoveryRowComplete(row: string[]): void {
  const [, ...observations] = row;
  expect(observations.length, "run recovery row must have four observation cells").toBe(4);

  for (const observation of observations) {
    const rule = validateObservation(observation, false, "acquisition-capable");
    expect(rule.completionEligible, "matrix completion requires an eligible cell state").toBe(true);
  }
}

function fillRecoveryMatrix(readiness: string): string {
  const today = utcDateOffset(0);
  return readiness
    .replace(
      recoveryMatrixCheckboxPattern,
      "- [x] The authorised live full fiscal year capability, target recovery, and run",
    )
    .replaceAll(
      "not-yet-run; date: not-recorded; reason: not-recorded",
      `fail-closed-as-expected; date: ${today}; reason: expected-fail-closed-boundary`,
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

function capabilityMatrix(readiness: string): string {
  return markedSection(readiness, capabilityStart, capabilityEnd);
}

async function readCapabilityMatrix(): Promise<string> {
  return capabilityMatrix(await readPublicationReadiness());
}

// Derived from the artifact type, not hand-listed: a bundle is the only shape a
// restart can land inside. Every offered selection must map to a documented shape,
// which is what keeps the reduced table from silently dropping a selection.
function derivePlanShape(artifactType: string): (typeof PLAN_SHAPES)[number] {
  return artifactType === "PDF_AND_EXCEL" ? "bundled-artifact-plan" : "single-artifact-plan";
}

function targetRecoveryMatrix(readiness: string): string {
  return markedSection(readiness, targetStart, targetEnd);
}

async function readTargetRecoveryMatrix(): Promise<string> {
  return targetRecoveryMatrix(await readPublicationReadiness());
}

function assertCanonicalRecoveryShapes(rows: string[][]): void {
  const documented = rows.map(([shape]) => shape);
  const offered = [
    ...new Set(
      FILED_RETURNS_RETURN_TYPES.flatMap((returnType) =>
        FILED_RETURNS_ARTIFACT_TYPES.filter((artifactType) =>
          supportsFiledReturnsArtifactType(returnType, artifactType),
        ).map((artifactType) => derivePlanShape(artifactType)),
      ),
    ),
  ];

  expect(
    documented.length === offered.length && offered.every((shape) => documented.includes(shape)),
    "run recovery matrix must carry exactly one row per offered plan shape",
  ).toBe(true);
  expect(new Set(documented).size).toBe(documented.length);
  for (const shape of documented) {
    expect(PLAN_SHAPES, `unknown plan shape ${shape}`).toContain(shape);
  }
}

function matrixRows(matrix: string, columns: readonly string[] = matrixColumns): string[][] {
  const lines = matrix
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  expect(lines.every((line) => line.startsWith("|") && line.endsWith("|"))).toBe(true);
  expect(lines.length).toBeGreaterThanOrEqual(3);

  const [header, separator, ...dataRows] = lines.map(parseMatrixRow);
  expect(
    header?.every((cell, index) => cell === columns[index]) && header.length === columns.length,
    "matrix header must match the canonical columns",
  ).toBe(true);
  expect(separator?.length, "matrix separator must match the canonical column count").toBe(
    columns.length,
  );
  expect(separator?.every((cell) => /^:?-{3,}:?$/.test(cell))).toBe(true);

  for (const row of dataRows) {
    expect(row.length, "matrix data row must match the canonical column count").toBe(
      columns.length,
    );
  }
  return dataRows;
}

function parseMatrixRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function checklistItems(section: string): Array<{ checked: boolean; text: string }> {
  const items: Array<{ checked: boolean; text: string }> = [];

  for (const line of section.split("\n")) {
    const item = line.match(/^- \[([ x])\] (.+)$/);
    if (item) {
      items.push({ checked: item[1] === "x", text: item[2] ?? "" });
    } else if (items.length > 0 && /^ {6}\S/.test(line)) {
      const current = items[items.length - 1];
      if (current) current.text += ` ${line.trim()}`;
    }
  }

  return items;
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

  expect(
    documentedSelections.length === offeredSelections.length &&
      documentedSelections.every((selection, index) => selection === offeredSelections[index]),
    "matrix selections must match canonical offered selections in order",
  ).toBe(true);
  expect(new Set(documentedSelections).size).toBe(documentedSelections.length);
}

function deriveRowCapability(returnType: string, artifactType: string): RowCapability {
  if (!isFiledReturnsReturnType(returnType) || !isFiledReturnsArtifactType(artifactType)) {
    throw new Error("matrix row does not use canonical return and artifact types");
  }

  return supportsFullFiscalYearFiledReturnsRun(returnType) &&
    supportsFiledReturnsArtifactType(returnType, artifactType)
    ? "acquisition-capable"
    : "not-acquisition-capable";
}

function validateObservation(
  observation: string,
  expectationColumn: boolean,
  rowCapability: RowCapability,
): ObservationCellRule {
  const parsed = observation.match(observationPattern);
  expect(parsed, "matrix cell has an invalid observation format").not.toBeNull();
  if (!parsed) throw new Error("matrix cell has an invalid observation format");

  const [, state, date, reason] = parsed;
  const matchingCellRules = observationCellRules.filter(
    (candidate) =>
      candidate.state === state &&
      candidate.reasons.includes(reason) &&
      dateMatchesConstraint(date ?? "", candidate.dateConstraint) &&
      columnMatchesConstraint(expectationColumn, candidate.columnConstraint),
  );
  const rule = matchingCellRules.find((candidate) =>
    rowCapabilityMatchesConstraint(rowCapability, candidate.rowCapabilityConstraint),
  );
  if (!rule) {
    const contradictoryClaim = matchingCellRules.find(
      (candidate) =>
        candidate.recordedRowCapability !== undefined &&
        candidate.recordedRowCapability !== rowCapability,
    )?.recordedRowCapability;
    if (contradictoryClaim) {
      throw new Error(
        `matrix row capability mismatch: derived ${rowCapability}; recorded ${contradictoryClaim}`,
      );
    }
  }
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

function rowCapabilityMatchesConstraint(
  rowCapability: RowCapability,
  constraint: RowCapabilityConstraint,
): boolean {
  return constraint === "any" || constraint === rowCapability;
}

function utcDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function renderObservationCellLegend(): string {
  const header = [
    "State",
    "Date constraint",
    "Reason",
    "Allowed column",
    "Derived row capability",
    "Recorded capability claim",
    "Completion-eligible",
  ];
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
    const rowCapability =
      rule.rowCapabilityConstraint === "any"
        ? "any derived capability"
        : `\`${rule.rowCapabilityConstraint}\``;
    const recordedCapability = rule.recordedRowCapability
      ? `\`${rule.recordedRowCapability}\``
      : "none";
    return [
      `\`${rule.state}\``,
      date,
      reasons,
      column,
      rowCapability,
      recordedCapability,
      rule.completionEligible ? "yes" : "no",
    ];
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

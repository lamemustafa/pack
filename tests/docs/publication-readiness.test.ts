import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FILED_RETURNS_ARTIFACT_TYPES,
  isFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "../../src/connectors/gst/filed-returns-artifacts";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import {
  FILED_RETURNS_RETURN_TYPES,
  isFiledReturnsReturnType,
  supportsFullFiscalYearFiledReturnsRun,
} from "../../src/connectors/gst/filed-returns-return-types";

const rootDir = process.cwd();
const matrixStart = "<!-- BEGIN: full-year-recovery-matrix -->";
const matrixEnd = "<!-- END: full-year-recovery-matrix -->";
const exportWindowMatrixStart = "<!-- BEGIN: full-year-export-window-recovery-matrix -->";
const exportWindowMatrixEnd = "<!-- END: full-year-export-window-recovery-matrix -->";
const allReturnsMatrixStart = "<!-- BEGIN: full-year-all-returns-recovery-matrix -->";
const allReturnsMatrixEnd = "<!-- END: full-year-all-returns-recovery-matrix -->";
const legendStart = "<!-- BEGIN: full-year-recovery-cell-legend -->";
const legendEnd = "<!-- END: full-year-recovery-cell-legend -->";
const storeChecklistStart = "## Chrome Web Store Checklist";
const storeChecklistEnd = "## Suggested Store Copy";
type ObservationColumnKind = "export-window" | "expectation" | "recovery";
interface ObservationColumn {
  kind: ObservationColumnKind;
  name: string;
}
const acquisitionRestartColumns: readonly ObservationColumn[] = [
  { kind: "recovery", name: "Service-worker restart" },
  { kind: "recovery", name: "Browser restart" },
];
// The export-window pair exists because the acquisition restart columns can both be satisfied
// before any ZIP is built (#347, #348). Its observations name which teardown was survived after
// the last target was saved.
const exportWindowColumns: readonly ObservationColumn[] = [
  { kind: "export-window", name: "Service-worker restart during export" },
  { kind: "export-window", name: "Browser restart during export" },
];
const laterRecoveryColumns: readonly ObservationColumn[] = [
  { kind: "recovery", name: "Interrupted download" },
  { kind: "recovery", name: "Cancellation/discard and cleanup" },
  { kind: "recovery", name: "Retained checkpoint; browser record unavailable" },
];
const expectationColumns: readonly ObservationColumn[] = [
  { kind: "expectation", name: "Expected fail-closed / not applicable" },
];
const selectionObservationColumns = [
  ...acquisitionRestartColumns,
  ...laterRecoveryColumns,
  ...expectationColumns,
];
const allReturnsObservationColumns = [
  ...acquisitionRestartColumns,
  ...exportWindowColumns,
  ...laterRecoveryColumns,
  ...expectationColumns,
];
const matrixColumns = ["Return type", "Artifact type", ...columnNames(selectionObservationColumns)];
const exportWindowMatrixColumns = [
  "Return type",
  "Artifact type",
  ...columnNames(exportWindowColumns),
];
const allReturnsMatrixColumns = [
  "Plan",
  "Returns and formats",
  ...columnNames(allReturnsObservationColumns),
];
const allReturnsPlanLabel = "All supported returns";
const observationPattern =
  /^([a-z]+(?:-[a-z]+)*); date: ([^;\s]+)(?:; reason: ([a-z]+(?:-[a-z]+)*))?$/;
type DateConstraint = "not-recorded" | "recorded-not-future";
type ColumnConstraint = "expectation-only" | "export-window-only" | "recovery-only" | "scenario";
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
    columnConstraint: "scenario",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    reasons: [undefined],
    rowCapabilityConstraint: "any",
    state: "pass",
  },
  {
    columnConstraint: "scenario",
    completionEligible: false,
    dateConstraint: "recorded-not-future",
    reasons: [undefined],
    rowCapabilityConstraint: "any",
    state: "fail",
  },
  {
    columnConstraint: "recovery-only",
    completionEligible: true,
    dateConstraint: "recorded-not-future",
    reasons: ["expected-fail-closed-boundary"],
    rowCapabilityConstraint: "any",
    state: "fail-closed-as-expected",
  },
  // Rebuilding and exporting the saved plan is the property an export-window column claims, and a
  // refusal does not demonstrate it (#347). The refusal stays recordable, so a safe stop is not
  // mislabelled a defect, but it cannot complete the gate.
  {
    columnConstraint: "export-window-only",
    completionEligible: false,
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
    columnConstraint: "scenario",
    completionEligible: false,
    dateConstraint: "recorded-not-future",
    reasons: ["recovery-scenario-not-applicable"],
    rowCapabilityConstraint: "acquisition-capable",
    state: "not-applicable",
  },
  {
    columnConstraint: "scenario",
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
    columnConstraint: "scenario",
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
  /^- \[( |x)\] The authorised live full fiscal year recovery matrix below is complete:/m;
const exportWindowMatrixCheckboxPattern =
  /^- \[( |x)\] The authorised live full fiscal year export-window restart matrix below is complete:/m;
const allReturnsMatrixCheckboxPattern =
  /^- \[( |x)\] The authorised live full fiscal year all-returns recovery matrix below is complete:/m;
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
    assertCanonicalSelections(matrixRows(await readRecoveryMatrix()));
  });

  it("tracks the all-returns plan as one row bound to the canonical plan expansion", async () => {
    assertCanonicalAllReturnsPlan(allReturnsMatrixRows(await readAllReturnsMatrix()));
  });

  it("rejects an all-returns row recorded against a different plan", async () => {
    const stale = (await readAllReturnsMatrix()).replace(
      canonicalAllReturnsPlanContents(),
      "GSTR-3B: PDF",
    );

    expect(() => assertCanonicalAllReturnsPlan(allReturnsMatrixRows(stale))).toThrow();
  });

  it("keeps every all-returns observation fillable, dated, and reasoned when required", async () => {
    for (const row of allReturnsMatrixRows(await readAllReturnsMatrix())) {
      const rowCapability = deriveAllReturnsRowCapability(row);
      const observations = row.slice(2);
      expect(observations.length).toBe(allReturnsObservationColumns.length);

      for (const [index, observation] of observations.entries()) {
        validateObservation(
          observation,
          observationColumnKind(allReturnsObservationColumns, index),
          rowCapability,
        );
      }
    }
  });

  it("tracks one export-window row per full-year return, on its all-formats selection", async () => {
    assertCanonicalExportWindowSelections(exportWindowMatrixRows(await readExportWindowMatrix()));
  });

  it("rejects an export-window row recorded on a narrower selection", async () => {
    const narrowed = (await readExportWindowMatrix()).replace(
      /\| GSTR-3B( *)\| PDF_AND_EXCEL \|/,
      (_match, padding: string) => `| GSTR-3B${padding}| PDF           |`,
    );

    expect(() => assertCanonicalExportWindowSelections(exportWindowMatrixRows(narrowed))).toThrow();
  });

  it("keeps every export-window observation fillable and dated", async () => {
    for (const [returnType = "", artifactType = "", ...observations] of exportWindowMatrixRows(
      await readExportWindowMatrix(),
    )) {
      const rowCapability = deriveRowCapability(returnType, artifactType);
      expect(observations.length).toBe(exportWindowColumns.length);

      for (const [index, observation] of observations.entries()) {
        validateObservation(
          observation,
          observationColumnKind(exportWindowColumns, index),
          rowCapability,
        );
      }
    }
  });

  it("records a boundary refusal in an export-window column without completing it", () => {
    const refusal = `fail-closed-as-expected; date: ${utcDateOffset(0)}; reason: expected-fail-closed-boundary`;

    expect(
      validateObservation(refusal, "export-window", "acquisition-capable").completionEligible,
    ).toBe(false);
    expect(validateObservation(refusal, "recovery", "acquisition-capable").completionEligible).toBe(
      true,
    );
  });

  it("cannot complete a row whose export-window observation is only a refusal", () => {
    const today = utcDateOffset(0);
    const pass = `pass; date: ${today}`;
    const refusal = `fail-closed-as-expected; date: ${today}; reason: expected-fail-closed-boundary`;
    const allReturns = allReturnsObservationColumns.map((column) =>
      column.kind === "expectation" ? refusal : pass,
    );
    const exportWindowIndex = allReturnsObservationColumns.findIndex(
      (column) => column.kind === "export-window",
    );
    const allReturnsWithRefusal = allReturns.map((cell, index) =>
      index === exportWindowIndex ? refusal : cell,
    );

    expect(() =>
      assertObservationsComplete(allReturns, allReturnsObservationColumns, "acquisition-capable"),
    ).not.toThrow();
    expect(() =>
      assertObservationsComplete(
        allReturnsWithRefusal,
        allReturnsObservationColumns,
        "acquisition-capable",
      ),
    ).toThrow();
    expect(() =>
      assertExportWindowRowComplete(["GSTR-3B", "PDF_AND_EXCEL", pass, pass]),
    ).not.toThrow();
    expect(() =>
      assertExportWindowRowComplete(["GSTR-3B", "PDF_AND_EXCEL", pass, refusal]),
    ).toThrow();
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
    const matrix = await readRecoveryMatrix();
    const unfilled = "not-yet-run; date: not-recorded";
    const unexpectedRow = [
      "Notes",
      "unexpected",
      ...Array<string>(selectionObservationColumns.length - 1).fill(unfilled),
      `${unfilled}; reason: not-recorded`,
    ];
    const matrixWithUnexpectedRow = `${matrix.trimEnd()}\n| ${unexpectedRow.join(" | ")} |\n`;

    expect(() => assertCanonicalSelections(matrixRows(matrixWithUnexpectedRow))).toThrow();
  });

  it("keeps every observation fillable, dated, and reasoned when required", async () => {
    const matrix = await readRecoveryMatrix();

    for (const [returnType = "", artifactType = "", ...observations] of matrixRows(matrix)) {
      const rowCapability = deriveRowCapability(returnType, artifactType);
      expect(observations.length, "matrix row must have one cell per observation column").toBe(
        selectionObservationColumns.length,
      );

      for (const [index, observation] of observations.entries()) {
        validateObservation(
          observation,
          observationColumnKind(selectionObservationColumns, index),
          rowCapability,
        );
      }
    }
  });

  it.each([
    "not-applicable; date: 2026-08-17; reason: expected-fail-closed-boundary",
    "fail-closed-as-expected; date: 2026-08-17; reason: recovery-scenario-not-applicable",
    "fail-closed-as-expected; date: 2026-08-17; reason: selection-not-acquisition-capable",
  ])("rejects a reason assigned to the wrong state: %s", (observation) => {
    expect(() => validateObservation(observation, "recovery", "acquisition-capable")).toThrow();
  });

  it("accepts today and past dates but rejects future evidence", () => {
    expect(() =>
      validateObservation(`pass; date: ${utcDateOffset(-1)}`, "recovery", "acquisition-capable"),
    ).not.toThrow();
    expect(() =>
      validateObservation(`pass; date: ${utcDateOffset(0)}`, "recovery", "acquisition-capable"),
    ).not.toThrow();
    expect(() =>
      validateObservation(`pass; date: ${utcDateOffset(1)}`, "recovery", "acquisition-capable"),
    ).toThrow();
  });

  it("allows date not-recorded only for the not-yet-run placeholder", () => {
    expect(() =>
      validateObservation("not-yet-run; date: not-recorded", "recovery", "acquisition-capable"),
    ).not.toThrow();
    expect(() =>
      validateObservation("pass; date: not-recorded", "recovery", "acquisition-capable"),
    ).toThrow();
    expect(() =>
      validateObservation(
        `not-yet-run; date: ${utcDateOffset(0)}`,
        "recovery",
        "acquisition-capable",
      ),
    ).toThrow();
  });

  it("rejects a combination absent from the whole-cell table", () => {
    expect(() =>
      validateObservation(
        `manual-review; date: ${utcDateOffset(0)}`,
        "recovery",
        "acquisition-capable",
      ),
    ).toThrow();
  });

  it.each([
    [
      "not-applicable; date: 2026-08-17; reason: recovery-scenario-not-applicable",
      "expectation" as const,
      "acquisition-capable" as const,
    ],
    [
      "not-applicable; date: 2026-08-17; reason: selection-not-acquisition-capable",
      "recovery" as const,
      "not-acquisition-capable" as const,
    ],
  ])("rejects a reason in the wrong column: %s", (observation, columnKind, rowCapability) => {
    expect(() => validateObservation(observation, columnKind, rowCapability)).toThrow();
  });

  it.each(["2026-99-99", "2026-02-29", "2026-04-31"])(
    "rejects the non-calendar date %s",
    (date) => {
      expect(() =>
        validateObservation(`pass; date: ${date}`, "recovery", "acquisition-capable"),
      ).toThrow();
    },
  );

  it("cannot mark the recovery gate complete while any observation is unfilled", async () => {
    const readiness = await readPublicationReadiness();
    assertRecoveryGate(readiness);
    assertExportWindowRecoveryGate(readiness);
    assertAllReturnsRecoveryGate(readiness);
  });

  it("cannot mark the export-window gate complete while any observation is unfilled", async () => {
    const unfilled = (await readPublicationReadiness()).replace(
      exportWindowMatrixCheckboxPattern,
      "- [x] The authorised live full fiscal year export-window restart matrix below is complete:",
    );

    expect(() => assertExportWindowRecoveryGate(unfilled)).toThrow();
  });

  it("cannot mark the export-window gate complete when a filled observation failed", async () => {
    const today = utcDateOffset(0);
    const completed = fillRecoveryMatrix(await readPublicationReadiness());
    const failed = replaceInSection(
      completed,
      exportWindowMatrix(completed),
      `pass; date: ${today}`,
      `fail; date: ${today}`,
    );

    expect(() => assertExportWindowRecoveryGate(completed)).not.toThrow();
    expect(() => assertExportWindowRecoveryGate(failed)).toThrow();
  });

  it("cannot mark the all-returns gate complete while any observation is unfilled", async () => {
    const unfilled = (await readPublicationReadiness()).replace(
      allReturnsMatrixCheckboxPattern,
      "- [x] The authorised live full fiscal year all-returns recovery matrix below is complete:",
    );

    expect(() => assertAllReturnsRecoveryGate(unfilled)).toThrow();
  });

  it("cannot mark the all-returns gate complete when its filled observation failed", async () => {
    const today = utcDateOffset(0);
    const completed = fillRecoveryMatrix(await readPublicationReadiness());
    const failed = replaceInAllReturnsMatrix(
      completed,
      `pass; date: ${today}`,
      `fail; date: ${today}`,
    );

    expect(() => assertRecoveryGate(failed)).not.toThrow();
    expect(() => assertAllReturnsRecoveryGate(failed)).toThrow();
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

    for (let scenario = 0; scenario < selectionObservationColumns.length - 1; scenario += 1) {
      completed = completed.replace(
        `pass; date: ${today}`,
        `not-applicable; date: ${today}; reason: recovery-scenario-not-applicable`,
      );
    }

    expect(() => assertRecoveryGate(completed)).toThrow();
  });

  it("allows a canonically non-capable selection to complete through its expected path", () => {
    const today = utcDateOffset(0);
    const scenario = `fail-closed-as-expected; date: ${today}; reason: expected-fail-closed-boundary`;
    const expectation = `not-applicable; date: ${today}; reason: selection-not-acquisition-capable`;

    expect(() =>
      assertRecoveryRowComplete([
        "GSTR-1",
        "JSON",
        ...Array<string>(selectionObservationColumns.length - 1).fill(scenario),
        expectation,
      ]),
    ).not.toThrow();
  });

  it("does not let a non-capable selection complete an export window by refusal", () => {
    const today = utcDateOffset(0);
    const refusal = `fail-closed-as-expected; date: ${today}; reason: expected-fail-closed-boundary`;
    const noExport = `not-applicable; date: ${today}; reason: recovery-scenario-not-applicable`;

    expect(() =>
      assertObservationsComplete(
        [noExport, noExport],
        exportWindowColumns,
        "not-acquisition-capable",
      ),
    ).not.toThrow();
    expect(() =>
      assertObservationsComplete(
        [refusal, noExport],
        exportWindowColumns,
        "not-acquisition-capable",
      ),
    ).toThrow();
  });

  it("rejects a recorded capability claim that contradicts the derived value", () => {
    const today = utcDateOffset(0);
    const expectation = `not-applicable; date: ${today}; reason: selection-not-acquisition-capable`;

    expect(() =>
      assertRecoveryRowComplete([
        "GSTR-3B",
        "PDF",
        ...Array<string>(selectionObservationColumns.length - 1).fill(`pass; date: ${today}`),
        expectation,
      ]),
    ).toThrow(
      "matrix row capability mismatch: derived acquisition-capable; recorded not-acquisition-capable",
    );
  });

  it("accepts a checked matrix only when every cell is completion-eligible", async () => {
    const completed = fillRecoveryMatrix(await readPublicationReadiness());
    expect(() => assertRecoveryGate(completed)).not.toThrow();
    expect(() => assertExportWindowRecoveryGate(completed)).not.toThrow();
    expect(() => assertAllReturnsRecoveryGate(completed)).not.toThrow();
  });
});

function assertRecoveryGate(readiness: string): void {
  const checkbox = readiness.match(recoveryMatrixCheckboxPattern);

  expect(checkbox).not.toBeNull();
  if (checkbox?.[1] !== "x") return;

  for (const row of matrixRows(recoveryMatrix(readiness))) assertRecoveryRowComplete(row);
}

function assertAllReturnsRecoveryGate(readiness: string): void {
  const checkbox = readiness.match(allReturnsMatrixCheckboxPattern);

  expect(checkbox).not.toBeNull();
  if (checkbox?.[1] !== "x") return;

  for (const row of allReturnsMatrixRows(allReturnsMatrix(readiness))) {
    assertObservationsComplete(
      row.slice(2),
      allReturnsObservationColumns,
      deriveAllReturnsRowCapability(row),
    );
  }
}

function assertExportWindowRecoveryGate(readiness: string): void {
  const checkbox = readiness.match(exportWindowMatrixCheckboxPattern);

  expect(checkbox).not.toBeNull();
  if (checkbox?.[1] !== "x") return;

  const rows = exportWindowMatrixRows(exportWindowMatrix(readiness));
  assertCanonicalExportWindowSelections(rows);
  for (const row of rows) assertExportWindowRowComplete(row);
}

function assertExportWindowRowComplete(row: string[]): void {
  const [returnType = "", artifactType = "", ...observations] = row;
  assertObservationsComplete(
    observations,
    exportWindowColumns,
    deriveRowCapability(returnType, artifactType),
  );
}

function assertRecoveryRowComplete(row: string[]): void {
  const [returnType = "", artifactType = "", ...observations] = row;
  assertObservationsComplete(
    observations,
    selectionObservationColumns,
    deriveRowCapability(returnType, artifactType),
  );
}

function assertObservationsComplete(
  observations: string[],
  columns: readonly ObservationColumn[],
  rowCapability: RowCapability,
): void {
  expect(observations.length, "matrix row must have one cell per observation column").toBe(
    columns.length,
  );
  for (const [index, observation] of observations.entries()) {
    const rule = validateObservation(
      observation,
      observationColumnKind(columns, index),
      rowCapability,
    );
    expect(rule.completionEligible, "matrix completion requires an eligible cell state").toBe(true);
  }
}

function columnNames(columns: readonly ObservationColumn[]): string[] {
  return columns.map((column) => column.name);
}

function observationColumnKind(
  columns: readonly ObservationColumn[],
  index: number,
): ObservationColumnKind {
  const column = columns[index];
  if (!column) throw new Error("matrix row has more observation cells than columns");
  return column.kind;
}

function fillRecoveryMatrix(readiness: string): string {
  const today = utcDateOffset(0);
  return readiness
    .replace(
      recoveryMatrixCheckboxPattern,
      "- [x] The authorised live full fiscal year recovery matrix below is complete:",
    )
    .replace(
      exportWindowMatrixCheckboxPattern,
      "- [x] The authorised live full fiscal year export-window restart matrix below is complete:",
    )
    .replace(
      allReturnsMatrixCheckboxPattern,
      "- [x] The authorised live full fiscal year all-returns recovery matrix below is complete:",
    )
    .replaceAll(
      "not-yet-run; date: not-recorded; reason: not-recorded",
      `fail-closed-as-expected; date: ${today}; reason: expected-fail-closed-boundary`,
    )
    .replaceAll("not-yet-run; date: not-recorded", `pass; date: ${today}`);
}

function replaceInAllReturnsMatrix(readiness: string, from: string, to: string): string {
  return replaceInSection(readiness, allReturnsMatrix(readiness), from, to);
}

function replaceInSection(readiness: string, section: string, from: string, to: string): string {
  expect(section.includes(from)).toBe(true);
  return readiness.replace(section, section.replace(from, to));
}

async function readExportWindowMatrix(): Promise<string> {
  return exportWindowMatrix(await readPublicationReadiness());
}

async function readAllReturnsMatrix(): Promise<string> {
  return allReturnsMatrix(await readPublicationReadiness());
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

function exportWindowMatrix(readiness: string): string {
  return markedSection(readiness, exportWindowMatrixStart, exportWindowMatrixEnd);
}

function allReturnsMatrix(readiness: string): string {
  return markedSection(readiness, allReturnsMatrixStart, allReturnsMatrixEnd);
}

function markedSection(document: string, startMarker: string, endMarker: string): string {
  const start = document.indexOf(startMarker);
  const end = document.indexOf(endMarker);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return document.slice(start + startMarker.length, end);
}

function matrixRows(matrix: string): string[][] {
  return tableRows(matrix, matrixColumns);
}

function exportWindowMatrixRows(matrix: string): string[][] {
  return tableRows(matrix, exportWindowMatrixColumns);
}

function allReturnsMatrixRows(matrix: string): string[][] {
  return tableRows(matrix, allReturnsMatrixColumns);
}

function tableRows(matrix: string, columns: readonly string[]): string[][] {
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

/**
 * The export window is shared by every selection; only the offscreen builder for derived files
 * branches, by return type and by whether portal JSON was staged. One row per full-year return,
 * on the selection that stages every offered format, exercises each builder branch once.
 */
function canonicalExportWindowSelections(): string[] {
  return FILED_RETURNS_RETURN_TYPES.filter(supportsFullFiscalYearFiledReturnsRun).map(
    (returnType) => {
      const artifactType = supportsFiledReturnsArtifactType(returnType, "PDF_AND_EXCEL")
        ? "PDF_AND_EXCEL"
        : FILED_RETURNS_ARTIFACT_TYPES.find((candidate) =>
            supportsFiledReturnsArtifactType(returnType, candidate),
          );
      return [returnType, artifactType ?? "none"].join(" | ");
    },
  );
}

function assertCanonicalExportWindowSelections(rows: string[][]): void {
  expect(
    rows.map(([returnType, artifactType]) => [returnType, artifactType].join(" | ")),
    "export-window matrix must hold one row per full-year return on its all-formats selection",
  ).toEqual(canonicalExportWindowSelections());
}

/**
 * The all-returns row is bound to the canonical plan expansion, so a return or format added to the
 * catalogue changes the expected row text and fails this test until the row is re-recorded: evidence
 * gathered against the old plan cannot silently stand for the new one.
 */
function canonicalAllReturnsPlanContents(): string {
  const expansion = expandAllSupportedFullFiscalYearTargetPlan();
  if (!expansion.ok) return "no full-year plan";
  return expansion.targets
    .map((target) => `${target.returnType}: ${target.concreteArtifactTypes.join(", ")}`)
    .join("; ");
}

function assertCanonicalAllReturnsPlan(rows: string[][]): void {
  expect(
    rows.map(([plan, contents]) => [plan, contents]),
    "all-returns matrix must hold exactly the canonical plan row",
  ).toEqual([[allReturnsPlanLabel, canonicalAllReturnsPlanContents()]]);
}

function deriveAllReturnsRowCapability(row: string[]): RowCapability {
  assertCanonicalAllReturnsPlan([row]);
  const expansion = expandAllSupportedFullFiscalYearTargetPlan();
  return expansion.ok && expansion.targets.length > 0
    ? "acquisition-capable"
    : "not-acquisition-capable";
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
  columnKind: ObservationColumnKind,
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
      columnMatchesConstraint(columnKind, candidate.columnConstraint),
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
  columnKind: ObservationColumnKind,
  constraint: ColumnConstraint,
): boolean {
  if (constraint === "scenario") return columnKind !== "expectation";
  if (constraint === "recovery-only") return columnKind === "recovery";
  if (constraint === "export-window-only") return columnKind === "export-window";
  return columnKind === "expectation";
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
    const column = {
      "expectation-only": "final expectation column",
      "export-window-only": "export-window columns",
      "recovery-only": "recovery scenario columns",
      scenario: "scenario columns",
    }[rule.columnConstraint];
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

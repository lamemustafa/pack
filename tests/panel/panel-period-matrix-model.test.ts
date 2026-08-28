import { describe, expect, it } from "vitest";
import {
  periodMatrixEligiblePeriods,
  periodMatrixRows,
  resolvePeriodMatrixSelection,
  wholeYearSelection,
} from "../../src/entrypoints/panel/panel-period-matrix-model";

const ASOF = new Date("2026-08-28T00:00:00.000Z");
const YEAR = "2025-26";

describe("period matrix selection", () => {
  it("offers a row per supported return type, each over the year's eligible months", () => {
    const rows = periodMatrixRows(YEAR, ASOF);
    const eligible = periodMatrixEligiblePeriods(YEAR, ASOF);

    expect(rows.map((row) => row.returnType)).toEqual(["GSTR-3B", "GSTR-1", "GSTR-2B"]);
    for (const row of rows) {
      expect(row.cells.map((cell) => cell.period)).toEqual(eligible);
    }
  });

  it("runs one cell as a single-period download", () => {
    const resolved = resolvePeriodMatrixSelection(
      { returnType: "GSTR-1", from: "June", to: "June" },
      YEAR,
      "PDF",
      ASOF,
    );

    expect(resolved).toEqual({
      runnable: true,
      kind: "scope",
      periodCount: 1,
      scope: { financialYear: YEAR, returnType: "GSTR-1", artifactType: "PDF", period: "June" },
    });
  });

  it("turns several months into a selected-targets request", () => {
    const resolved = resolvePeriodMatrixSelection(
      { returnType: "GSTR-1", from: "April", to: "June" },
      YEAR,
      "PDF",
      ASOF,
    );

    expect(resolved).toMatchObject({ runnable: true, kind: "selection", periodCount: 3 });
    expect(resolved.runnable === true && resolved.kind === "selection" && resolved.request).toEqual(
      {
        kind: "selected-filed-returns-targets",
        financialYear: YEAR,
        targets: [
          { returnType: "GSTR-1", period: "April", artifactType: "PDF" },
          { returnType: "GSTR-1", period: "May", artifactType: "PDF" },
          { returnType: "GSTR-1", period: "June", artifactType: "PDF" },
        ],
      },
    );
  });

  it("runs a range that starts after the first month of the year", () => {
    // Refused while completion authority was the canonical year. A selected run is judged
    // against its own recorded plan, so a mid-year range is an ordinary selection.
    const resolved = resolvePeriodMatrixSelection(
      { returnType: "GSTR-1", from: "June", to: "August" },
      YEAR,
      "PDF",
      ASOF,
    );

    expect(resolved).toMatchObject({ runnable: true, kind: "selection", periodCount: 3 });
    expect(
      resolved.runnable === true &&
        resolved.kind === "selection" &&
        resolved.request.targets.map((target) => target.period),
    ).toEqual(["June", "July", "August"]);
  });

  it("selects the whole eligible year from a row label", () => {
    const selection = wholeYearSelection("GSTR-2B", YEAR, ASOF);
    const eligible = periodMatrixEligiblePeriods(YEAR, ASOF);

    expect(selection).toEqual({
      returnType: "GSTR-2B",
      from: eligible[0],
      to: eligible.at(-1),
    });

    const resolved = resolvePeriodMatrixSelection(selection, YEAR, "PDF", ASOF);
    expect(resolved.runnable).toBe(true);
    expect(resolved.runnable === true && resolved.periodCount).toBe(eligible.length);
    expect(resolved.runnable === true && resolved.kind).toBe("selection");
  });

  it("asks for a selection before there is one", () => {
    const resolved = resolvePeriodMatrixSelection(null, YEAR, "PDF", ASOF);
    expect(resolved.runnable).toBe(false);
  });
});

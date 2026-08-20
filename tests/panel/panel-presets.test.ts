import { describe, expect, it } from "vitest";
import { panelPresets, presetPeriodCount } from "../../src/entrypoints/panel/panel-presets";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { FILED_RETURNS_RETURN_TYPES } from "../../src/connectors/gst/filed-returns-return-types";
import { supportsFiledReturnsArtifactType } from "../../src/connectors/gst/filed-returns-artifacts";

const ASOF = new Date("2026-08-21T00:00:00.000Z");

describe("panel presets", () => {
  it("offers one whole-year preset per supported return type", () => {
    const presets = panelPresets(ASOF);
    expect(presets.map((preset) => preset.scope.returnType)).toEqual([
      ...FILED_RETURNS_RETURN_TYPES,
    ]);
  });

  it("only produces scopes the runtime can already execute", () => {
    for (const preset of panelPresets(ASOF)) {
      // A preset that needed the plan runner would be a button that does nothing.
      expect(preset.scope.period).toBe(FULL_FISCAL_YEAR_PERIOD);
      expect(
        supportsFiledReturnsArtifactType(
          preset.scope.returnType,
          preset.scope.artifactType ?? "PDF",
        ),
      ).toBe(true);
    }
  });

  it("pins every preset to the current financial year", () => {
    const years = new Set(panelPresets(ASOF).map((preset) => preset.scope.financialYear));
    expect(years.size).toBe(1);
    expect([...years][0]).toBe("2026-27");
  });

  it("counts the periods a preset will actually walk, not twelve", () => {
    for (const preset of panelPresets(ASOF)) {
      const count = presetPeriodCount(preset, ASOF);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(12);
    }
  });

  it("describes each return from the capability table rather than a hand-written string", () => {
    const details = panelPresets(ASOF).map((preset) => preset.detail);
    expect(details.every((detail) => detail.length > 0)).toBe(true);
    expect(new Set(details).size).toBe(details.length);
  });
});

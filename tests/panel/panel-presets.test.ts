import { describe, expect, it } from "vitest";
import { panelPresets, presetPeriodCount } from "../../src/entrypoints/panel/panel-presets";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { FILED_RETURNS_RETURN_TYPES } from "../../src/connectors/gst/filed-returns-return-types";
import {
  normaliseFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "../../src/connectors/gst/filed-returns-artifacts";
import {
  filedReturnsCapabilityArtifactLabel,
  filedReturnsCapabilitySummary,
} from "../../src/connectors/gst/filed-returns-capabilities";

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

  it("describes the artifact its own scope requests, from the capability table", () => {
    for (const preset of panelPresets(ASOF)) {
      expect(preset.detail).toBe(
        filedReturnsCapabilityArtifactLabel(
          preset.scope.returnType,
          normaliseFiledReturnsArtifactType(preset.scope.returnType, preset.scope.artifactType),
        ),
      );
      // The capability *summary* is what the presets used to borrow. GSTR-1's names an
      // Excel workbook no preset scope asks the portal for.
      expect(preset.detail).not.toBe(filedReturnsCapabilitySummary(preset.scope.returnType));
    }
  });

  it("labels every preset from the scope normalisation actually produced", () => {
    // 10 April 2026 IST: FY 2026-27 has begun with no completed period, so the requested
    // year is not the year the run will walk.
    const april = new Date("2026-04-10T09:00:00+05:30");
    for (const preset of panelPresets(april)) {
      expect(preset.scope.financialYear).toBe("2025-26");
      expect(preset.label).toBe(`2025-26 ${preset.scope.returnType}`);
    }
  });
});

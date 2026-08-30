import { describe, expect, it } from "vitest";
import { filedReturnsOfferedArtifacts } from "../../src/connectors/gst/filed-returns-capabilities";
import { supportedFiledReturnsCatalogueEntries } from "../../src/connectors/gst/filed-returns-catalogue";
import { FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND } from "../../src/connectors/gst/filed-returns-contracts";
import { getFiledReturnsFullFiscalYearPeriods } from "../../src/connectors/gst/filed-returns-scope";
import { panelAllReturnsFullYearPreset } from "../../src/entrypoints/panel/panel-guided-scope-model";

const AS_OF = new Date("2026-08-30T00:00:00.000Z");

describe("all-returns panel presets", () => {
  it("derives the current-year label, partial-year note, and every displayed count from the eligible catalogue", () => {
    const financialYear = "2026-27";
    const preset = panelAllReturnsFullYearPreset(financialYear, AS_OF);
    const eligible = supportedFiledReturnsCatalogueEntries().filter(
      (entry) => entry.capability.fullFiscalYear,
    );
    const periodCount = getFiledReturnsFullFiscalYearPeriods(financialYear, AS_OF).length;
    const artifactCount = eligible.reduce(
      (count, entry) => count + filedReturnsOfferedArtifacts(entry.returnType).length,
      0,
    );

    expect(preset).toEqual({
      kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
      financialYear,
      label: "Everything this year",
      note: `Partial year · ${periodCount} filed periods so far.`,
      returnCount: eligible.length,
      periodCount,
      artifactCount,
      fileCount: artifactCount * periodCount,
    });
  });

  it("labels the preceding complete financial year without a second label constant", () => {
    const preset = panelAllReturnsFullYearPreset("2025-26", AS_OF);

    expect(preset).not.toBeNull();
    expect(preset).toMatchObject({
      financialYear: "2025-26",
      label: "Everything last year",
      note: "Complete financial year.",
      periodCount: 12,
      fileCount: 84,
    });
  });

  it("does not offer an empty or unavailable expansion", () => {
    expect(panelAllReturnsFullYearPreset("2026-27", AS_OF, [])).toBeNull();
    expect(
      panelAllReturnsFullYearPreset("2017-18", new Date("2017-06-01T00:00:00.000Z")),
    ).toBeNull();
  });
});

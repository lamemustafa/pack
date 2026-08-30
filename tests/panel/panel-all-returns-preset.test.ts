import { describe, expect, it } from "vitest";
import { filedReturnsOfferedArtifacts } from "../../src/connectors/gst/filed-returns-capabilities";
import { supportedFiledReturnsCatalogueEntries } from "../../src/connectors/gst/filed-returns-catalogue";
import { FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND } from "../../src/connectors/gst/filed-returns-contracts";
import { getFiledReturnsFullFiscalYearPeriods } from "../../src/connectors/gst/filed-returns-scope";
import { panelAllReturnsFullYearPreset } from "../../src/entrypoints/panel/panel-guided-scope-model";

const AS_OF = new Date("2026-08-26T00:00:00.000Z");

describe("everything-this-year panel preset", () => {
  it("derives one root plan and every displayed count from the eligible catalogue", () => {
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
      returnCount: eligible.length,
      targetPeriodCount: eligible.length * periodCount,
      artifactCount,
      fileCount: artifactCount * periodCount,
    });
  });

  it("does not offer an empty or unavailable expansion", () => {
    expect(panelAllReturnsFullYearPreset("2026-27", AS_OF, [])).toBeNull();
    expect(
      panelAllReturnsFullYearPreset("2017-18", new Date("2017-06-01T00:00:00.000Z")),
    ).toBeNull();
  });
});

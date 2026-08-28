import { describe, expect, it } from "vitest";
import { panelFullFiscalYearPresets } from "../../src/entrypoints/panel/panel-guided-scope-model";
import { filedReturnsOfferedArtifacts } from "../../src/connectors/gst/filed-returns-capabilities";
import { supportedFiledReturnsCatalogueEntries } from "../../src/connectors/gst/filed-returns-catalogue";

const AS_OF = new Date("2026-08-26T00:00:00.000Z");

describe("preset artifact selection", () => {
  // A preset exists to remove a decision. Taking whichever artifact happened to
  // be first in the catalogue made that decision silently: "This year's GSTR-2B"
  // fetched a summary PDF while the return offers three formats, and the card
  // never said which one it would bring.
  it("takes every format a return offers, not the first one listed", () => {
    for (const preset of panelFullFiscalYearPresets("2026-27", AS_OF)) {
      const offered = filedReturnsOfferedArtifacts(preset.scope.returnType as never);
      if (offered.length > 1) {
        expect(preset.scope.artifactType, `${preset.scope.returnType} preset`).toBe(
          "PDF_AND_EXCEL",
        );
      } else {
        expect(preset.scope.artifactType).toBe(offered[0]);
      }
    }
  });

  it("states the format on the card", () => {
    const presets = panelFullFiscalYearPresets("2026-27", AS_OF);
    expect(presets.length).toBeGreaterThan(0);
    for (const preset of presets) {
      expect(preset.artifactLabel, `${preset.scope.returnType} label`).toBeTruthy();
    }
  });

  it("covers every supported full-year row", () => {
    const supported = supportedFiledReturnsCatalogueEntries().filter(
      (e) => (e.capability as { fullFiscalYear?: boolean }).fullFiscalYear,
    );
    expect(panelFullFiscalYearPresets("2026-27", AS_OF)).toHaveLength(supported.length);
  });
});

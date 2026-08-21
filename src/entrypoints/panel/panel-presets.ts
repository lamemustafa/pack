import type { FiledReturnsDownloadScope } from "../../connectors/gst/filed-returns-contracts";
import { filedReturnsCapabilityArtifactLabel } from "../../connectors/gst/filed-returns-capabilities.ts";
import { normaliseFiledReturnsArtifactType } from "../../connectors/gst/filed-returns-artifacts";
import {
  FULL_FISCAL_YEAR_PERIOD,
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsPeriodOptions,
  normaliseFiledReturnsScope,
} from "../../connectors/gst/filed-returns-scope";
import { FILED_RETURNS_RETURN_TYPES } from "../../connectors/gst/filed-returns-return-types";

/**
 * A preset is a named result that resolves to one scope the runtime can already execute.
 *
 * Deliberately not a multi-target plan: the background runs one scope at a time today, so a
 * preset that needed a queue would be a button that does nothing. Presets that require the
 * plan runner are absent rather than disabled — see design-lab/01-claude/10-target-plan.md.
 *
 * Both strings a preset shows are derived from `scope` after normalisation, never from the
 * inputs that produced it. Two separate defects came from the other direction: a label
 * written from the *requested* financial year promised "this year" while an April run
 * downloads the preceding one, and a detail taken from the return's whole capability
 * summary advertised Excel to a scope that only ever requests a PDF.
 */
export interface PanelPreset {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly scope: FiledReturnsDownloadScope;
}

/**
 * The default view offers one preset per return type: that return, for the whole current
 * financial year. This is the shape the market leader sells ("whole financial year in one
 * click") and the shape a full-year run already supports end to end.
 */
export function panelPresets(asOf = new Date()): PanelPreset[] {
  const financialYear = getFiledReturnsFinancialYearOptions(asOf)[0];
  if (!financialYear) return [];
  return FILED_RETURNS_RETURN_TYPES.map((returnType) => {
    // Normalise first. In April the new Indian financial year has no completed period yet,
    // so this answers with the preceding year; everything the control says is then read
    // back off the scope the click will actually submit.
    const scope = normaliseFiledReturnsScope(
      {
        financialYear,
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType,
        artifactType: "PDF",
      },
      asOf,
    );
    return {
      id: `full-year-${returnType.toLowerCase()}`,
      label: `${scope.financialYear} ${scope.returnType}`,
      detail: filedReturnsCapabilityArtifactLabel(
        scope.returnType,
        normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
      ),
      scope,
    };
  });
}

/** How many periods a full-year preset will actually walk, for the count on the control. */
export function presetPeriodCount(preset: PanelPreset, asOf = new Date()): number {
  return getFiledReturnsPeriodOptions(preset.scope.financialYear, asOf).length;
}

export type PanelView = "presets" | "custom";

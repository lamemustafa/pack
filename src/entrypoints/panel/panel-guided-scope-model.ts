import {
  FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  type FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  type FiledReturnsAllSupportedFullFiscalYearRequest,
  type FiledReturnsDownloadScope,
} from "../../connectors/gst/filed-returns-contracts";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../connectors/gst/filed-returns-all-supported-full-fiscal-year";
import type { FiledReturnsArtifactType } from "../../connectors/gst/filed-returns-artifact-types";
import { concreteFiledReturnsArtifactTypesForSelection } from "../../connectors/gst/filed-returns-artifacts";
import {
  filedReturnsCapability,
  filedReturnsOfferedArtifacts,
  supportedFiledReturnsCatalogueEntries,
  type SupportedReturnTypeCapability,
  type FiledReturnsPeriodicity,
} from "../../connectors/gst/filed-returns-capabilities";
import {
  FULL_FISCAL_YEAR_PERIOD,
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsFullFiscalYearPeriods,
  getFiledReturnsScopePeriodOptions,
  normaliseFiledReturnsScope,
} from "../../connectors/gst/filed-returns-scope";
import type { FiledReturnsReturnType } from "../../connectors/gst/filed-returns-return-types";
import { createScopeFormModel, returnTypeOptions } from "../popup/scope-form-model";

export type GuidedStepKey = "returnType" | "financialYear" | "period" | "artifactType";

export interface GuidedOption {
  readonly disabled?: boolean;
  readonly value: string;
  readonly label: string;
}

export interface PanelGuidedStep {
  readonly key: GuidedStepKey;
  readonly title: string;
  readonly hint: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly GuidedOption[];
}

type PresetCatalogueEntry = {
  readonly returnType: FiledReturnsReturnType;
  readonly capability: Pick<
    SupportedReturnTypeCapability,
    "artifacts" | "fullFiscalYear" | "label"
  >;
};

export interface PanelFullFiscalYearPreset {
  readonly label: string;
  readonly periodCount: number;
  readonly scope: FiledReturnsDownloadScope;
}

/**
 * This is deliberately not a `FiledReturnsDownloadScope`: that type remains an
 * atomic portal target. The root action needs its own callback and eventual
 * message contract so it cannot be mistaken for one selected return.
 */
export type PanelAllReturnsFullYearPlan = FiledReturnsAllSupportedFullFiscalYearRequest;

export interface PanelAllReturnsFullYearPreset extends PanelAllReturnsFullYearPlan {
  readonly label: string;
  /** Return coverage is derived from the same expanded target plan the action runs. */
  readonly returnTypes: readonly FiledReturnsReturnType[];
  /** A factual note about whether the selected financial year is complete. */
  readonly note: string;
  /** Number of catalogue rows represented by this one root plan. */
  readonly returnCount: number;
  /** Eligible filing periods for each represented return. */
  readonly periodCount: number;
  /** Concrete portal formats selected across every eligible return. */
  readonly artifactCount: number;
  /** The maximum concrete portal-file requests before not-filed outcomes. */
  readonly fileCount: number;
  /** Atomic targets expected at the displayed eligibility snapshot. */
  readonly targetSignature: string;
}

/**
 * The durable plan details a recovery card needs. This deliberately comes
 * from persisted target evidence rather than a calendar re-expansion: an
 * interrupted plan resumes its immutable target list.
 */
export interface PanelAllReturnsFullYearResumePlan {
  readonly financialYear: string;
  readonly returnTypes: readonly FiledReturnsReturnType[];
  readonly returnCount: number;
  readonly periodCount: number;
  readonly artifactCount: number;
  readonly fileCount: number;
}

export function panelAllReturnsFullYearResumePlan(
  summary: Pick<
    FiledReturnsAllSupportedFullFiscalYearFlowSummary,
    "summaryIdentity" | "targetEvidence"
  >,
): PanelAllReturnsFullYearResumePlan | null {
  const summaryIdentity = summary.summaryIdentity;
  if (!summaryIdentity) return null;
  const targets = summary.targetEvidence.filter(
    (target) => target.financialYear === summaryIdentity.financialYear,
  );
  if (targets.length === 0) return null;

  const periods = new Set(targets.map((target) => target.period));
  const returnTypes = new Set(targets.map((target) => target.returnType));
  const artifactCount = Array.from(
    new Map(
      targets.map((target) => [
        `${target.returnType}:${target.artifactType}`,
        concreteFiledReturnsArtifactTypesForSelection(target.returnType, target.artifactType)
          .length,
      ]),
    ).values(),
  ).reduce((count, concreteCount) => count + concreteCount, 0);
  const fileCount = targets.reduce(
    (count, target) =>
      count +
      concreteFiledReturnsArtifactTypesForSelection(target.returnType, target.artifactType).length,
    0,
  );
  if (periods.size === 0 || returnTypes.size === 0 || artifactCount === 0 || fileCount === 0)
    return null;

  return {
    financialYear: summaryIdentity.financialYear,
    returnTypes: Array.from(returnTypes),
    returnCount: returnTypes.size,
    periodCount: periods.size,
    artifactCount,
    fileCount,
  };
}

/**
 * The home view is a projection of the canonical catalogue, rather than its own list of
 * returns. A supported full-year row gets a preset as soon as it has catalogue data; the
 * label, default artifact and advertised number are all read from the same sources the run uses.
 */
export function panelFullFiscalYearPresets(
  financialYear: string,
  asOf = new Date(),
  catalogue: readonly PresetCatalogueEntry[] = supportedFiledReturnsCatalogueEntries(),
): readonly PanelFullFiscalYearPreset[] {
  return catalogue.flatMap(({ returnType, capability }) => {
    if (!capability.fullFiscalYear) return [];
    const periodCount = getFiledReturnsFullFiscalYearPeriods(
      financialYear,
      asOf,
      returnType,
    ).length;
    if (periodCount === 0) return [];
    // A preset exists to remove a decision. Taking whichever artifact happened to
    // be listed first in the catalogue made that decision silently: "This year's
    // GSTR-2B" fetched a summary PDF while the return offers three formats.
    // Where a return offers more than one, the preset takes all of them; a
    // narrower choice lives on the guided path.
    const offered = filedReturnsOfferedArtifacts(returnType);
    const presetArtifactType: FiledReturnsArtifactType | undefined =
      offered.length > 1 ? "PDF_AND_EXCEL" : offered[0];
    if (!presetArtifactType) return [];
    return [
      {
        label: `This year's ${capability.label}`,
        periodCount,
        scope: {
          financialYear,
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType,
          artifactType: presetArtifactType,
        },
      },
    ];
  });
}

/**
 * Build the panel's root-plan affordance from the same canonical catalogue as
 * individual presets. A missing period, return, or offered artifact leaves no
 * safe expansion, so the control is absent rather than pretending an empty
 * plan is actionable.
 */
export function panelAllReturnsFullYearPreset(
  financialYear: string,
  asOf = new Date(),
  catalogue: readonly PresetCatalogueEntry[] = supportedFiledReturnsCatalogueEntries(),
): PanelAllReturnsFullYearPreset | null {
  const expansion = expandAllSupportedFullFiscalYearTargetPlan({
    catalogueEntries: catalogue.map(({ returnType, capability }) => ({
      returnType,
      fullFiscalYear: capability.fullFiscalYear,
    })),
    offeredArtifacts: filedReturnsOfferedArtifacts,
  });
  if (!expansion.ok) return null;

  const periodsByReturn = expansion.targets.map(({ returnType }) => ({
    returnType,
    periods: getFiledReturnsFullFiscalYearPeriods(financialYear, asOf, returnType),
  }));
  const periodCount = new Set(periodsByReturn.flatMap((plan) => plan.periods)).size;
  if (periodCount === 0) return null;

  const artifactCount = expansion.targets.reduce(
    (count, target) => count + target.concreteArtifactTypes.length,
    0,
  );
  const financialYearPosition = getFiledReturnsFinancialYearOptions(asOf).indexOf(financialYear);
  const label =
    financialYearPosition === 0
      ? "Everything this year"
      : financialYearPosition === 1
        ? "Everything last year"
        : `Everything in ${financialYear}`;
  const note =
    financialYearPosition === 0
      ? `Partial year · ${periodCount} eligible ${periodCount === 1 ? "period" : "periods"} so far.`
      : financialYearPosition === 1
        ? "Complete financial year."
        : `${periodCount} eligible ${periodCount === 1 ? "period" : "periods"}.`;

  return {
    kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
    financialYear,
    label,
    returnTypes: expansion.targets.map((target) => target.returnType),
    note,
    returnCount: expansion.targets.length,
    periodCount,
    artifactCount,
    fileCount: expansion.targets.reduce(
      (count, target) =>
        count +
        (periodsByReturn.find((plan) => plan.returnType === target.returnType)?.periods.length ??
          0) *
          target.concreteArtifactTypes.length,
      0,
    ),
    targetSignature: expansion.targets
      .flatMap((target) =>
        (periodsByReturn.find((plan) => plan.returnType === target.returnType)?.periods ?? []).map(
          (period) => `${target.returnType}:${target.artifactType}:${period}`,
        ),
      )
      .sort()
      .join("|"),
  };
}

const PERIOD_STEP_COPY = {
  monthly: {
    title: "Which filed period?",
    hint: "Choose one month or the full fiscal year.",
    label: "Filed period",
  },
  quarterly: {
    title: "Which filed quarter?",
    hint: "Choose one quarter or the full fiscal year.",
    label: "Filed quarter",
  },
  annual: {
    title: "Which financial year?",
    hint: "This return has one annual filing period.",
    label: "Annual period",
  },
  none: {
    title: "Confirm the scope",
    hint: "This item does not use a filing period.",
    label: "Scope",
  },
} as const satisfies Record<
  FiledReturnsPeriodicity,
  { title: string; hint: string; label: string }
>;

const PERIOD_OPTIONS_BY_PERIODICITY = {
  monthly: (financialYear: string, asOf: Date, returnType: FiledReturnsReturnType) =>
    getFiledReturnsScopePeriodOptions(financialYear, asOf, returnType),
  quarterly: (financialYear: string) =>
    [1, 2, 3, 4].map((quarter) => ({
      value: `${financialYear}-Q${quarter}`,
      label: `Q${quarter} · ${financialYear}`,
    })),
  annual: (financialYear: string) => [
    { value: "FULL_FISCAL_YEAR", label: `Annual · ${financialYear}` },
  ],
  none: () => [{ value: "NOT_PERIOD_BASED", label: "Not period-based" }],
} satisfies Record<
  FiledReturnsPeriodicity,
  (financialYear: string, asOf: Date, returnType: FiledReturnsReturnType) => readonly GuidedOption[]
>;

export function cataloguePeriodOptions(
  periodicity: FiledReturnsPeriodicity,
  financialYear: string,
  returnType: FiledReturnsReturnType,
  asOf = new Date(),
): readonly GuidedOption[] {
  return PERIOD_OPTIONS_BY_PERIODICITY[periodicity](financialYear, asOf, returnType);
}

export function panelGuidedSteps(
  scope: FiledReturnsDownloadScope,
  asOf = new Date(),
): readonly PanelGuidedStep[] {
  const capability = filedReturnsCapability(scope.returnType);
  const formModel = createScopeFormModel(scope);
  return [
    {
      key: "returnType",
      title: "Which return?",
      hint: "Choose one supported return for this run.",
      label: "Return",
      value: scope.returnType,
      options: returnTypeOptions(),
    },
    {
      key: "financialYear",
      title: "Which financial year?",
      hint: "Pack keeps each run within one financial year.",
      label: "Financial year",
      value: scope.financialYear,
      options: getFiledReturnsFinancialYearOptions(asOf)
        .filter(
          (financialYear) =>
            getFiledReturnsScopePeriodOptions(financialYear, asOf, scope.returnType).length > 0,
        )
        .map((financialYear) => ({
          value: financialYear,
          label: financialYear,
        })),
    },
    {
      key: "period",
      ...PERIOD_STEP_COPY[capability.periodicity],
      value: scope.period,
      options: cataloguePeriodOptions(
        capability.periodicity,
        scope.financialYear,
        scope.returnType,
        asOf,
      ),
    },
    {
      key: "artifactType",
      title: "Which file?",
      hint: "Choose one artifact selection offered for this return.",
      label: "File",
      value: formModel.selectedArtifactType,
      options: formModel.artifactOptions,
    },
  ];
}

export function panelGuidedStepForDisplay(
  step: PanelGuidedStep,
  fullYearFlowAvailable: boolean,
): PanelGuidedStep {
  const selectableOptions =
    step.key === "period" && !fullYearFlowAvailable
      ? step.options.filter((option) => option.value !== FULL_FISCAL_YEAR_PERIOD)
      : step.options;
  const options =
    step.key === "period" && !fullYearFlowAvailable && step.value === FULL_FISCAL_YEAR_PERIOD
      ? [
          {
            value: FULL_FISCAL_YEAR_PERIOD,
            label: "Full fiscal year (saved run)",
            disabled: true,
          },
          ...selectableOptions,
        ]
      : selectableOptions;
  return {
    ...step,
    options,
    hint:
      step.key === "period"
        ? `Choose one of: ${selectableOptions.map((option) => option.label).join(", ")}.`
        : step.hint,
  };
}

export function updatePanelGuidedScope(
  scope: FiledReturnsDownloadScope,
  key: GuidedStepKey,
  value: string,
): FiledReturnsDownloadScope {
  if (key === "returnType") {
    return normaliseFiledReturnsScope({ ...scope, returnType: value as FiledReturnsReturnType });
  }
  if (key === "financialYear")
    return normaliseFiledReturnsScope({ ...scope, financialYear: value });
  if (key === "period") return normaliseFiledReturnsScope({ ...scope, period: value });
  return normaliseFiledReturnsScope({
    ...scope,
    artifactType: value as NonNullable<FiledReturnsDownloadScope["artifactType"]>,
  });
}

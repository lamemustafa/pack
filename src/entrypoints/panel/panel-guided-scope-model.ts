import type { FiledReturnsDownloadScope } from "../../connectors/gst/filed-returns-contracts";
import {
  filedReturnsCapability,
  type FiledReturnsPeriodicity,
} from "../../connectors/gst/filed-returns-capabilities";
import {
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsScopePeriodOptions,
  normaliseFiledReturnsScope,
} from "../../connectors/gst/filed-returns-scope";
import type { FiledReturnsReturnType } from "../../connectors/gst/filed-returns-return-types";
import { createScopeFormModel, returnTypeOptions } from "../popup/scope-form-model";

export type GuidedStepKey = "returnType" | "financialYear" | "period" | "artifactType";

export interface GuidedOption {
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
      options: getFiledReturnsFinancialYearOptions(asOf).map((financialYear) => ({
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

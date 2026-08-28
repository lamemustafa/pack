import {
  filedReturnsOfferedArtifacts,
  supportedFiledReturnsCatalogueEntries,
} from "./filed-returns-capabilities";
import type {
  FiledReturnsArtifactType,
  FiledReturnsConcreteArtifactType,
} from "./filed-returns-artifacts";
import {
  FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  type FiledReturnsAllSupportedFullFiscalYearRequest,
} from "./filed-returns-contracts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export interface FiledReturnsAllSupportedFullFiscalYearPlanTarget {
  returnType: FiledReturnsReturnType;
  /** The existing selection vocabulary, derived from the offered concrete formats. */
  artifactType: FiledReturnsArtifactType;
  /** Immutable concrete-format snapshot used to prove the selected "all" set. */
  concreteArtifactTypes: readonly FiledReturnsConcreteArtifactType[];
}

export type FiledReturnsAllSupportedFullFiscalYearPlanExpansion =
  | {
      ok: true;
      targets: readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[];
    }
  | {
      ok: false;
      reason: "no-full-fiscal-year-returns" | "return-has-no-offered-artifacts";
      returnType?: FiledReturnsReturnType;
    };

export interface FiledReturnsAllSupportedFullFiscalYearPlanDependencies {
  catalogueEntries: readonly {
    returnType: FiledReturnsReturnType;
    fullFiscalYear: boolean;
  }[];
  offeredArtifacts: (
    returnType: FiledReturnsReturnType,
  ) => readonly FiledReturnsConcreteArtifactType[];
}

const DEFAULT_PLAN_DEPENDENCIES: FiledReturnsAllSupportedFullFiscalYearPlanDependencies = {
  catalogueEntries: supportedFiledReturnsCatalogueEntries().map((entry) => ({
    returnType: entry.returnType,
    fullFiscalYear: entry.capability.fullFiscalYear,
  })),
  offeredArtifacts: filedReturnsOfferedArtifacts,
};

export function createAllSupportedFullFiscalYearRequest(
  financialYear: string,
): FiledReturnsAllSupportedFullFiscalYearRequest | null {
  if (!isFiledReturnsFinancialYear(financialYear)) return null;
  return {
    kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
    financialYear,
  };
}

export function isAllSupportedFullFiscalYearRequest(
  input: unknown,
): input is FiledReturnsAllSupportedFullFiscalYearRequest {
  return (
    isRecord(input) &&
    hasOnlyKeys(input, ["kind", "financialYear"]) &&
    input.kind === FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND &&
    isFiledReturnsFinancialYear(input.financialYear)
  );
}

/**
 * Expands the canonical supported catalogue into the return-level target plan
 * for an all-supported-returns year run. Period targets are added by the
 * durable runner later, after it has captured this exact selection snapshot.
 */
export function expandAllSupportedFullFiscalYearTargetPlan(
  dependencies: FiledReturnsAllSupportedFullFiscalYearPlanDependencies = DEFAULT_PLAN_DEPENDENCIES,
): FiledReturnsAllSupportedFullFiscalYearPlanExpansion {
  const fullFiscalYearEntries = dependencies.catalogueEntries.filter(
    (entry) => entry.fullFiscalYear,
  );
  if (fullFiscalYearEntries.length === 0) {
    return { ok: false, reason: "no-full-fiscal-year-returns" };
  }

  const targets: FiledReturnsAllSupportedFullFiscalYearPlanTarget[] = [];
  for (const entry of fullFiscalYearEntries) {
    const concreteArtifactTypes = [...dependencies.offeredArtifacts(entry.returnType)];
    if (concreteArtifactTypes.length === 0) {
      return {
        ok: false,
        reason: "return-has-no-offered-artifacts",
        returnType: entry.returnType,
      };
    }
    targets.push({
      returnType: entry.returnType,
      artifactType:
        concreteArtifactTypes.length === 1 ? concreteArtifactTypes[0]! : "PDF_AND_EXCEL",
      concreteArtifactTypes,
    });
  }
  return { ok: true, targets };
}

function isFiledReturnsFinancialYear(input: unknown): input is string {
  return typeof input === "string" && /^20\d{2}-\d{2}$/.test(input);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

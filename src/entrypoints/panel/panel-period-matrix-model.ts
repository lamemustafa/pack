import type {
  FiledReturnsDownloadScope,
  FiledReturnsSelectedTarget,
  FiledReturnsSelectedTargetsRequest,
} from "../../connectors/gst/filed-returns-contracts";
import { createSelectedFiledReturnsTargetsRequest } from "../../connectors/gst/filed-returns-selected-target-plan";
import {
  supportedFiledReturnsCatalogueEntries,
  type FiledReturnsSupportedCatalogueEntry,
} from "../../connectors/gst/filed-returns-catalogue";
import {
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsFullFiscalYearPeriods,
} from "../../connectors/gst/filed-returns-scope";
import type { FiledReturnsReturnType } from "../../connectors/gst/filed-returns-return-types";

/**
 * The selection model behind the period grid.
 *
 * Kept apart from the component because the interesting part is not the drawing: it is what a
 * selection becomes. Any set of months a person picks is runnable -- completion authority for
 * such a run is the plan recorded when it was created, not the canonical year -- so the grid
 * does not have to refuse ranges that skip a month or start after April.
 *
 * A selection resolves to one of two shapes:
 *
 *   one cell    -> an ordinary single-period scope, which already had its own flow
 *   many cells  -> a selected-targets request, canonicalised by the selection contract
 */

export interface PeriodMatrixRow {
  readonly returnType: FiledReturnsReturnType;
  readonly label: string;
  /** Every month of the fiscal year, in order, whether or not it can be chosen. */
  readonly cells: readonly PeriodMatrixCell[];
}

export interface PeriodMatrixCell {
  readonly period: string;
  /** False for a month this return cannot be asked for yet -- unfiled, or out of the year. */
  readonly selectable: boolean;
}

export interface PeriodMatrixSelection {
  readonly returnType: FiledReturnsReturnType;
  readonly from: string;
  readonly to: string;
}

export type PeriodMatrixRunnable = Extract<PeriodMatrixResolution, { runnable: true }>;

export type PeriodMatrixResolution =
  | {
      readonly runnable: true;
      readonly kind: "scope";
      readonly scope: FiledReturnsDownloadScope;
      readonly periodCount: number;
    }
  | {
      readonly runnable: true;
      readonly kind: "selection";
      readonly request: FiledReturnsSelectedTargetsRequest;
      readonly periodCount: number;
    }
  | { readonly runnable: false; readonly reason: string };

export function periodMatrixFinancialYears(asOf = new Date()): string[] {
  return [...getFiledReturnsFinancialYearOptions(asOf)];
}

/**
 * One row per supported return type, each carrying that year's eligible months.
 *
 * Selectability is read from the same period source a run plans from, so a cell can never
 * offer a month the runner would then decline to plan.
 */
export function periodMatrixRows(
  financialYear: string,
  asOf = new Date(),
  entries: readonly FiledReturnsSupportedCatalogueEntry[] = supportedFiledReturnsCatalogueEntries(),
): PeriodMatrixRow[] {
  const eligible = getFiledReturnsFullFiscalYearPeriods(financialYear, asOf);
  return entries.map((entry) => ({
    returnType: entry.returnType,
    label: entry.capability.label,
    cells: eligible.map((period) => ({ period, selectable: true })),
  }));
}

export function periodMatrixEligiblePeriods(financialYear: string, asOf = new Date()): string[] {
  return [...getFiledReturnsFullFiscalYearPeriods(financialYear, asOf)];
}

/** The whole eligible year for one return type, which is what a row label selects. */
export function wholeYearSelection(
  returnType: FiledReturnsReturnType,
  financialYear: string,
  asOf = new Date(),
): PeriodMatrixSelection | null {
  const periods = periodMatrixEligiblePeriods(financialYear, asOf);
  const from = periods[0];
  const to = periods.at(-1);
  return from && to ? { returnType, from, to } : null;
}

/**
 * Turns a selection into something that can be started, or explains why it cannot be.
 *
 * The refusal text names the constraint rather than the symptom: someone who painted June to
 * August needs to know a run has to start at the first month, not that "the selection is
 * invalid".
 */
export function resolvePeriodMatrixSelection(
  selection: PeriodMatrixSelection | null,
  financialYear: string,
  artifactType: FiledReturnsDownloadScope["artifactType"],
  asOf = new Date(),
): PeriodMatrixResolution {
  if (!selection) return { runnable: false, reason: "Choose one or more periods to download." };

  const periods = periodMatrixEligiblePeriods(financialYear, asOf);
  const fromIndex = periods.indexOf(selection.from);
  const toIndex = periods.indexOf(selection.to);
  if (fromIndex < 0 || toIndex < 0 || toIndex < fromIndex) {
    return { runnable: false, reason: "That period is not available for this year yet." };
  }

  const chosen = periods.slice(fromIndex, toIndex + 1);
  if (chosen.length === 1) {
    return {
      runnable: true,
      kind: "scope",
      periodCount: 1,
      scope: {
        financialYear,
        returnType: selection.returnType,
        period: selection.from,
        ...(artifactType ? { artifactType } : {}),
      },
    };
  }

  // The contract canonicalises and de-duplicates, and refuses anything it cannot vouch for.
  // A null here means the grid built something the runner would not accept, which is a defect
  // rather than a user error, so it reads as unavailable instead of blaming the selection.
  const request = createSelectedFiledReturnsTargetsRequest(
    financialYear,
    chosen.map((period) => ({
      returnType: selection.returnType,
      period: period as FiledReturnsSelectedTarget["period"],
      artifactType: artifactType ?? "PDF",
    })),
  );
  if (!request) {
    return { runnable: false, reason: "Pack cannot prepare that selection. Choose it again." };
  }
  return { runnable: true, kind: "selection", request, periodCount: chosen.length };
}

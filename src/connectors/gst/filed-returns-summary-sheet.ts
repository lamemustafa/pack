import { CsvSizeLimitError, toCsv, type CsvCellValue } from "../../core/csv";
import { flattenJsonTextScalarLeaves, JsonFlatTableLimitError } from "../../core/json-flat-table";
import type { FiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import { FILED_RETURNS_MONTHS, type FiledReturnsMonth } from "./filed-returns-scope";

export const FILED_RETURNS_SUMMARY_SHEET_PATH = "full-year-summary.csv";
export const FILED_RETURNS_SUMMARY_ARRAY_RULE =
  "Arrays are represented by element count at their JSON Pointer path; array elements are not expanded.";
export const FILED_RETURNS_SUMMARY_TEXT_RULE =
  "Text that begins like a spreadsheet formula is prefixed with an apostrophe.";
export const FILED_RETURNS_SUMMARY_NUMBER_RULE =
  "JSON number tokens are emitted as apostrophe-prefixed text to preserve their exact portal spelling.";

export type FiledReturnsSummaryOutcomeCategory = "staged" | "not-filed" | "artifact-unavailable";

export interface FiledReturnsSummaryPlanEntry {
  artifactType: FiledReturnsConcreteArtifactType;
  entryNames: string[];
  outcomeCategory: FiledReturnsSummaryOutcomeCategory;
  period: FiledReturnsMonth;
  returnType: FiledReturnsReturnType;
}

export interface FiledReturnsSummarySourceEntry {
  path: string;
  bytes: Uint8Array;
}

export interface FiledReturnsSummarySheet {
  bytes: Uint8Array;
  outcomeOnly: boolean;
  parsedPeriodCount: number;
  rowCount: number;
}

export class FiledReturnsSummaryTooLargeError extends Error {
  constructor() {
    super("Filed-return summary exceeded its local output limit.");
    this.name = "FiledReturnsSummaryTooLargeError";
  }
}

const METADATA_HEADERS = [
  "pack:format",
  "pack:array_rule",
  "pack:number_rule",
  "pack:text_rule",
  "pack:period",
  "pack:return_type",
  "pack:artifact",
  "pack:outcome_category",
] as const;
const PERIOD_ORDER = new Map(FILED_RETURNS_MONTHS.map((period, index) => [period, index]));
const ARTIFACT_ORDER: Record<FiledReturnsConcreteArtifactType, number> = {
  PDF: 0,
  EXCEL: 1,
  JSON: 2,
};

export function buildFiledReturnsSummarySheet(
  plan: readonly FiledReturnsSummaryPlanEntry[],
  entries: readonly FiledReturnsSummarySourceEntry[],
  maxOutputBytes = Number.POSITIVE_INFINITY,
): FiledReturnsSummarySheet {
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const jsonHeaders = new Set<string>();
  const parsedPeriods = new Set<FiledReturnsMonth>();
  let remainingFlattenedBytes = maxOutputBytes;
  const rows = [...plan].sort(comparePlanEntries).map((planned) => {
    const row: Record<string, CsvCellValue> = {
      "pack:format": "portal-json-flat-v1",
      "pack:array_rule": FILED_RETURNS_SUMMARY_ARRAY_RULE,
      "pack:number_rule": FILED_RETURNS_SUMMARY_NUMBER_RULE,
      "pack:text_rule": FILED_RETURNS_SUMMARY_TEXT_RULE,
      "pack:period": planned.period,
      "pack:return_type": planned.returnType,
      "pack:artifact": planned.artifactType,
      "pack:outcome_category": outcomeCategory(planned),
    };
    if (planned.artifactType !== "JSON" || planned.outcomeCategory !== "staged") {
      return row;
    }

    const entry = planned.entryNames
      .map((entryName) => entriesByPath.get(entryName))
      .find((candidate) => candidate !== undefined);
    if (!entry) {
      row["pack:outcome_category"] = "json-entry-missing";
      return row;
    }
    try {
      const leaves = flattenJsonTextScalarLeaves(
        new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes),
        remainingFlattenedBytes,
      );
      remainingFlattenedBytes -= approximateFlatRowBytes(leaves);
      for (const [path, value] of Object.entries(leaves)) {
        const header = `json:${path}`;
        jsonHeaders.add(header);
        row[header] = value;
      }
      row["pack:outcome_category"] = "parseable-json";
      parsedPeriods.add(planned.period);
    } catch (error) {
      if (error instanceof JsonFlatTableLimitError) {
        throw new FiledReturnsSummaryTooLargeError();
      }
      row["pack:outcome_category"] = "json-unparseable";
    }
    return row;
  });

  const headers = [...METADATA_HEADERS, ...[...jsonHeaders].sort(compareCodeUnits)];
  try {
    return {
      bytes: new TextEncoder().encode(toCsv(rows, headers, { maxUtf8Bytes: maxOutputBytes })),
      outcomeOnly: parsedPeriods.size === 0,
      parsedPeriodCount: parsedPeriods.size,
      rowCount: rows.length,
    };
  } catch (error) {
    if (error instanceof CsvSizeLimitError) throw new FiledReturnsSummaryTooLargeError();
    throw error;
  }
}

function outcomeCategory(entry: FiledReturnsSummaryPlanEntry): string {
  if (entry.outcomeCategory !== "staged") return entry.outcomeCategory;
  return entry.artifactType === "JSON" ? "json-unparsed" : "non-json-artifact";
}

function comparePlanEntries(
  left: FiledReturnsSummaryPlanEntry,
  right: FiledReturnsSummaryPlanEntry,
): number {
  const periodDifference =
    (PERIOD_ORDER.get(left.period) ?? FILED_RETURNS_MONTHS.length) -
    (PERIOD_ORDER.get(right.period) ?? FILED_RETURNS_MONTHS.length);
  if (periodDifference !== 0) return periodDifference;
  const returnDifference = compareCodeUnits(left.returnType, right.returnType);
  if (returnDifference !== 0) return returnDifference;
  return ARTIFACT_ORDER[left.artifactType] - ARTIFACT_ORDER[right.artifactType];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function approximateFlatRowBytes(row: Record<string, CsvCellValue>): number {
  const encoder = new TextEncoder();
  return Object.entries(row).reduce(
    (total, [path, value]) =>
      total +
      encoder.encode(path).byteLength +
      encoder.encode(value === null ? "null" : String(value)).byteLength +
      4,
    0,
  );
}

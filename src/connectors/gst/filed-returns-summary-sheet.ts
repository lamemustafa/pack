import {
  CsvSizeLimitError,
  csvEmptyString,
  csvNumberText,
  toCsv,
  type CsvCellValue,
} from "../../core/csv";
import {
  flattenJsonTextScalarLeaves,
  JsonFlatTableLimitError,
  type FlatJsonLeaf,
} from "../../core/json-flat-table";
import type { FiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import {
  filedReturnsSummaryFieldLabel,
  filedReturnsSummaryIdentityLabel,
  isFiledReturnsSummaryForbiddenFieldPath,
} from "./filed-returns-summary-labels";
import { FILED_RETURNS_MONTHS, type FiledReturnsMonth } from "./filed-returns-scope";

export const FILED_RETURNS_SUMMARY_SHEET_PATH = "full-year-summary.csv";
export const FILED_RETURNS_SUMMARY_CONTEXT_PATH = "full-year-summary-context.csv";
export const FILED_RETURNS_SUMMARY_FORMAT_VERSION = "pack-full-year-summary-tidy-v1";
export const MAX_FILED_RETURNS_SUMMARY_ROWS = 100_000;
export const FILED_RETURNS_SUMMARY_ARRAY_RULE =
  "Arrays are represented by their element count at the array's JSON Pointer path; array elements are not expanded.";
export const FILED_RETURNS_SUMMARY_NUMBER_RULE =
  "JSON number tokens are expanded without rounding into plain decimal notation in value_number; spreadsheet software may apply its own numeric precision limits.";
export const FILED_RETURNS_SUMMARY_TEXT_RULE =
  "JSON strings, booleans, and null use value_text; an empty JSON string is a quoted empty CSV cell, while formula-like text is apostrophe-prefixed for spreadsheet safety.";
export const FILED_RETURNS_SUMMARY_LABEL_RULE =
  "field_label is populated only by the return-type label map with recorded official-source provenance; otherwise it is empty and field_path remains canonical.";
export const FILED_RETURNS_SUMMARY_IDENTITY_RULE =
  "Recognized taxpayer identity fields are removed from the data CSV and written once in this context CSV; inconsistent identity values fail summary generation.";

export const FILED_RETURNS_SUMMARY_HEADERS = [
  "period",
  "return_type",
  "artifact",
  "outcome",
  "field_label",
  "field_path",
  "value_text",
  "value_number",
] as const;

export const FILED_RETURNS_SUMMARY_CONTEXT_HEADERS = [
  "context_type",
  "context_key",
  "field_label",
  "field_path",
  "value_text",
] as const;

export type FiledReturnsSummaryOutcomeCategory = "staged" | "not-filed" | "artifact-unavailable";

export interface FiledReturnsSummaryPlanEntry {
  artifactType: FiledReturnsConcreteArtifactType;
  entryNames: string[];
  financialYear: string;
  outcomeCategory: FiledReturnsSummaryOutcomeCategory;
  period: FiledReturnsMonth;
  returnType: FiledReturnsReturnType;
}

export interface FiledReturnsSummarySourceEntry {
  path: string;
  bytes: Uint8Array;
}

export interface FiledReturnsSummarySheet {
  contextBytes: Uint8Array;
  dataBytes: Uint8Array;
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

interface ParsedPlanEntry {
  leaves: FlatJsonLeaf[];
  outcome: string;
  planned: FiledReturnsSummaryPlanEntry;
}

interface SummaryIdentityValue {
  fieldPath: string;
  label: string;
  value: string;
}

const OUTCOME_FIELD_PATH = "pack:outcome";
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
  const sortedPlan = [...plan].sort(comparePlanEntries);
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const parsedPeriods = new Set<FiledReturnsMonth>();
  let remainingFlattenedBytes = maxOutputBytes;
  const parsedEntries = sortedPlan.map((planned): ParsedPlanEntry => {
    if (planned.artifactType !== "JSON" || planned.outcomeCategory !== "staged") {
      return { planned, leaves: [], outcome: outcomeCategory(planned) };
    }
    const entry = planned.entryNames
      .map((entryName) => entriesByPath.get(entryName))
      .find((candidate) => candidate !== undefined);
    if (!entry) return { planned, leaves: [], outcome: "json-entry-missing" };
    try {
      const leaves = flattenJsonTextScalarLeaves(
        new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes),
        remainingFlattenedBytes,
      );
      remainingFlattenedBytes -= approximateFlatLeavesBytes(leaves);
      parsedPeriods.add(planned.period);
      return { planned, leaves, outcome: "parseable-json" };
    } catch (error) {
      if (error instanceof JsonFlatTableLimitError) throw new FiledReturnsSummaryTooLargeError();
      return { planned, leaves: [], outcome: "json-unparseable" };
    }
  });

  rejectForbiddenFields(parsedEntries);
  const identityByLabel = collectIdentityValues(parsedEntries);
  const dataRows: Record<string, CsvCellValue>[] = [];
  for (const parsed of parsedEntries) {
    const fieldLeaves = parsed.leaves.filter((leaf) => {
      const identityLabel = filedReturnsSummaryIdentityLabel(leaf.path);
      return identityLabel === null || !identityByLabel.has(identityLabel);
    });
    if (fieldLeaves.length === 0) {
      dataRows.push(outcomeRow(parsed.planned, parsed.outcome));
      continue;
    }
    for (const leaf of fieldLeaves) {
      dataRows.push({
        period: parsed.planned.period,
        return_type: parsed.planned.returnType,
        artifact: parsed.planned.artifactType,
        outcome: parsed.outcome,
        field_label: filedReturnsSummaryFieldLabel(parsed.planned.returnType, leaf.path),
        field_path: leaf.path,
        value_text:
          leaf.valueKind === "text"
            ? leaf.value === ""
              ? csvEmptyString()
              : leaf.value
            : undefined,
        value_number: leaf.valueKind === "number" ? csvNumberText(leaf.value) : undefined,
      });
      if (dataRows.length > MAX_FILED_RETURNS_SUMMARY_ROWS) {
        throw new FiledReturnsSummaryTooLargeError();
      }
    }
  }

  try {
    const dataCsv = toCsv(dataRows, FILED_RETURNS_SUMMARY_HEADERS, {
      maxUtf8Bytes: maxOutputBytes,
    });
    const dataBytes = new TextEncoder().encode(dataCsv);
    const contextRows = buildContextRows(sortedPlan, identityByLabel);
    const contextCsv = toCsv(contextRows, FILED_RETURNS_SUMMARY_CONTEXT_HEADERS, {
      maxUtf8Bytes: Math.max(0, maxOutputBytes - dataBytes.byteLength),
    });
    return {
      contextBytes: new TextEncoder().encode(contextCsv),
      dataBytes,
      outcomeOnly: parsedPeriods.size === 0,
      parsedPeriodCount: parsedPeriods.size,
      rowCount: dataRows.length,
    };
  } catch (error) {
    if (error instanceof CsvSizeLimitError) throw new FiledReturnsSummaryTooLargeError();
    throw error;
  }
}

function rejectForbiddenFields(parsedEntries: readonly ParsedPlanEntry[]): void {
  for (const parsed of parsedEntries) {
    if (parsed.leaves.some((leaf) => isFiledReturnsSummaryForbiddenFieldPath(leaf.path))) {
      throw new SyntaxError("Filed-return summary source contains a credential or session field.");
    }
  }
}

function collectIdentityValues(
  parsedEntries: readonly ParsedPlanEntry[],
): Map<string, SummaryIdentityValue> {
  const identityByLabel = new Map<string, SummaryIdentityValue>();
  const parseableEntries = parsedEntries.filter((entry) => entry.outcome === "parseable-json");
  const occurrenceCountByLabel = new Map<string, number>();
  for (const parsed of parseableEntries) {
    const identityInEntry = new Map<string, SummaryIdentityValue>();
    for (const leaf of parsed.leaves) {
      const label = filedReturnsSummaryIdentityLabel(leaf.path);
      if (!label) continue;
      const existingInEntry = identityInEntry.get(label);
      if (existingInEntry && existingInEntry.value !== leaf.value) {
        throw new SyntaxError("Inconsistent taxpayer identity in filed-return summary source.");
      }
      if (!existingInEntry || compareCodeUnits(leaf.path, existingInEntry.fieldPath) < 0) {
        identityInEntry.set(label, { fieldPath: leaf.path, label, value: leaf.value });
      }
    }
    for (const [label, identity] of identityInEntry) {
      const existing = identityByLabel.get(label);
      if (existing && existing.value !== identity.value) {
        throw new SyntaxError("Inconsistent taxpayer identity in filed-return summary source.");
      }
      if (!existing || compareCodeUnits(identity.fieldPath, existing.fieldPath) < 0) {
        identityByLabel.set(label, identity);
      }
      occurrenceCountByLabel.set(label, (occurrenceCountByLabel.get(label) ?? 0) + 1);
    }
  }
  for (const label of identityByLabel.keys()) {
    if (occurrenceCountByLabel.get(label) !== parseableEntries.length) {
      throw new SyntaxError("Inconsistent taxpayer identity in filed-return summary source.");
    }
  }
  return identityByLabel;
}

function outcomeRow(
  planned: FiledReturnsSummaryPlanEntry,
  outcome: string,
): Record<string, CsvCellValue> {
  return {
    period: planned.period,
    return_type: planned.returnType,
    artifact: planned.artifactType,
    outcome,
    field_label: "",
    field_path: OUTCOME_FIELD_PATH,
    value_text: undefined,
    value_number: undefined,
  };
}

function buildContextRows(
  plan: readonly FiledReturnsSummaryPlanEntry[],
  identityByLabel: ReadonlyMap<string, SummaryIdentityValue>,
): Record<string, CsvCellValue>[] {
  const financialYears = sortedUnique(plan.map((entry) => entry.financialYear));
  if (financialYears.length !== 1) {
    throw new SyntaxError("Filed-return summary plan must have one financial year.");
  }
  const metadata = [
    ["format_version", FILED_RETURNS_SUMMARY_FORMAT_VERSION],
    ["data_file", FILED_RETURNS_SUMMARY_SHEET_PATH],
    ["context_file", FILED_RETURNS_SUMMARY_CONTEXT_PATH],
    ["financial_year", financialYears[0]!],
    ["return_types", sortedUnique(plan.map((entry) => entry.returnType)).join("|")],
    ["artifacts", sortedUnique(plan.map((entry) => entry.artifactType)).join("|")],
    [
      "planned_periods",
      FILED_RETURNS_MONTHS.filter((period) => plan.some((entry) => entry.period === period)).join(
        "|",
      ),
    ],
  ].map(([contextKey, valueText]) => contextRow("run_metadata", contextKey!, valueText!));
  const rules = [
    ["array_rule", FILED_RETURNS_SUMMARY_ARRAY_RULE],
    ["number_rule", FILED_RETURNS_SUMMARY_NUMBER_RULE],
    ["text_rule", FILED_RETURNS_SUMMARY_TEXT_RULE],
    ["label_rule", FILED_RETURNS_SUMMARY_LABEL_RULE],
    ["identity_rule", FILED_RETURNS_SUMMARY_IDENTITY_RULE],
  ].map(([contextKey, valueText]) => contextRow("format_rule", contextKey!, valueText!));
  const identities = [...identityByLabel.values()]
    .sort((left, right) => compareCodeUnits(left.label, right.label))
    .map((identity) => ({
      context_type: "taxpayer_identity",
      context_key: "identity",
      field_label: identity.label,
      field_path: identity.fieldPath,
      value_text: identity.value,
    }));
  return [...metadata, ...rules, ...identities];
}

function contextRow(
  contextType: "run_metadata" | "format_rule",
  contextKey: string,
  valueText: string,
): Record<string, CsvCellValue> {
  return {
    context_type: contextType,
    context_key: contextKey,
    field_label: "",
    field_path: "",
    value_text: valueText,
  };
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

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function approximateFlatLeavesBytes(leaves: readonly FlatJsonLeaf[]): number {
  const encoder = new TextEncoder();
  return leaves.reduce(
    (total, leaf) =>
      total + encoder.encode(leaf.path).byteLength + encoder.encode(leaf.value).byteLength + 4,
    0,
  );
}

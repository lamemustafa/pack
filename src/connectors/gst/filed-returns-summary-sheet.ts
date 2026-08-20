import {
  CsvSizeLimitError,
  csvEmptyString,
  csvNumberText,
  toCsv,
  type CsvCellValue,
} from "../../core/csv";
import {
  flatJsonLeavesApproximateBytes,
  flattenJsonTextObjectAtPath,
  flattenJsonTextSelectedScalarLeaves,
  JsonFlatTableLimitError,
  JsonFlatTablePathNotFoundError,
  type FlatJsonLeaf,
} from "../../core/json-flat-table";
import { filedReturnsJsonDocumentContract } from "./artifact-validation";
import type { FiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import { filedReturnsSummaryArrayExpansion } from "./filed-returns-summary-arrays";
import {
  filedReturnsSummaryFieldLabel,
  filedReturnsSummaryIdentity,
  isFiledReturnsSummaryForbiddenFieldPath,
  isFiledReturnsSummaryIdentityPath,
} from "./filed-returns-summary-labels";
import { FILED_RETURNS_MONTHS, type FiledReturnsMonth } from "./filed-returns-scope";

export const FILED_RETURNS_SUMMARY_SHEET_PATH = "full-year-summary.csv";
export const MAX_FILED_RETURNS_SUMMARY_ROWS = 100_000;

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
  contextRows: FiledReturnsSummaryContextRow[];
  dataBytes: Uint8Array;
  dataRows: FiledReturnsSummaryDataRow[];
  outcomeOnly: boolean;
  parsedPeriodCount: number;
  rowCount: number;
}

export interface FiledReturnsSummaryDataRow {
  artifact: FiledReturnsConcreteArtifactType;
  fieldLabel: string;
  fieldPath: string;
  outcome: string;
  period: FiledReturnsMonth;
  returnType: FiledReturnsReturnType;
  valueNumber?: string;
  valueText?: string;
}

export interface FiledReturnsSummaryContextRow {
  contextKey: string;
  contextType: "taxpayer_identity" | "return_identity";
  fieldLabel: string;
  fieldPath: string;
  valueText: string;
}

export class FiledReturnsSummaryTooLargeError extends Error {
  constructor() {
    super("Filed-return summary exceeded its local output limit.");
    this.name = "FiledReturnsSummaryTooLargeError";
  }
}

class FiledReturnsSummaryForbiddenFieldError extends SyntaxError {}

interface ParsedPlanEntry {
  identityLeaves: FlatJsonLeaf[];
  leaves: FlatJsonLeaf[];
  outcome: string;
  planned: FiledReturnsSummaryPlanEntry;
}

interface SummaryIdentityValue {
  contextKey: string;
  contextType: "taxpayer_identity" | "return_identity";
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
      return { planned, identityLeaves: [], leaves: [], outcome: outcomeCategory(planned) };
    }
    const entry = planned.entryNames
      .map((entryName) => entriesByPath.get(entryName))
      .find((candidate) => candidate !== undefined);
    if (!entry) return { planned, identityLeaves: [], leaves: [], outcome: "json-entry-missing" };
    try {
      const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes);
      const identityLeaves = flattenJsonTextSelectedScalarLeaves(
        jsonText,
        {
          includePath: (path) => filedReturnsSummaryIdentity(path) !== null,
          visitPath: rejectForbiddenFieldPath,
        },
        remainingFlattenedBytes,
      );
      const leaves = flattenJsonTextObjectAtPath(
        jsonText,
        filedReturnsJsonDocumentContract(planned.returnType).envelopePath,
        remainingFlattenedBytes,
        filedReturnsSummaryArrayExpansion(planned.returnType),
      );
      remainingFlattenedBytes -= flatJsonLeavesApproximateBytes(leaves);
      parsedPeriods.add(planned.period);
      return { planned, identityLeaves, leaves, outcome: "parseable-json" };
    } catch (error) {
      if (error instanceof FiledReturnsSummaryForbiddenFieldError) throw error;
      if (error instanceof JsonFlatTableLimitError) throw new FiledReturnsSummaryTooLargeError();
      if (error instanceof JsonFlatTablePathNotFoundError) {
        return { planned, identityLeaves: [], leaves: [], outcome: "json-envelope-missing" };
      }
      return { planned, identityLeaves: [], leaves: [], outcome: "json-unparseable" };
    }
  });

  rejectForbiddenFields(parsedEntries);
  const identities = collectIdentityValues(parsedEntries);
  const dataRows: FiledReturnsSummaryDataRow[] = [];
  for (const parsed of parsedEntries) {
    const fieldLeaves = parsed.leaves.filter(
      (leaf) => !isFiledReturnsSummaryIdentityPath(leaf.path),
    );
    if (fieldLeaves.length === 0) {
      dataRows.push(outcomeRow(parsed.planned, parsed.outcome));
      continue;
    }
    for (const leaf of fieldLeaves) {
      dataRows.push({
        period: parsed.planned.period,
        returnType: parsed.planned.returnType,
        artifact: parsed.planned.artifactType,
        outcome: leaf.arrayCountReason ?? parsed.outcome,
        fieldLabel: filedReturnsSummaryFieldLabel(parsed.planned.returnType, leaf.path),
        fieldPath: leaf.path,
        ...(leaf.valueKind === "text" ? { valueText: leaf.value } : {}),
        ...(leaf.valueKind === "number" ? { valueNumber: leaf.value } : {}),
      });
      if (dataRows.length > MAX_FILED_RETURNS_SUMMARY_ROWS) {
        throw new FiledReturnsSummaryTooLargeError();
      }
    }
  }

  try {
    const dataCsv = toCsv(dataRows.map(dataCsvRow), FILED_RETURNS_SUMMARY_HEADERS, {
      maxUtf8Bytes: maxOutputBytes,
    });
    const dataBytes = new TextEncoder().encode(dataCsv);
    const contextRows = buildContextRows(sortedPlan, identities);
    return {
      contextRows,
      dataBytes,
      dataRows,
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
    for (const leaf of parsed.leaves) rejectForbiddenFieldPath(leaf.path);
  }
}

function rejectForbiddenFieldPath(path: string): void {
  if (isFiledReturnsSummaryForbiddenFieldPath(path)) {
    throw new FiledReturnsSummaryForbiddenFieldError(
      "Filed-return summary source contains a credential or session field.",
    );
  }
}

function collectIdentityValues(parsedEntries: readonly ParsedPlanEntry[]): SummaryIdentityValue[] {
  const taxpayerIdentityByLabel = new Map<string, SummaryIdentityValue>();
  const returnIdentityByKey = new Map<string, SummaryIdentityValue>();
  const parseableEntries = parsedEntries.filter((entry) => entry.outcome === "parseable-json");
  for (const parsed of parseableEntries) {
    const identityInEntry = new Map<string, SummaryIdentityValue>();
    for (const leaf of parsed.identityLeaves) {
      const descriptor = filedReturnsSummaryIdentity(leaf.path);
      if (!descriptor) continue;
      const contextKey =
        descriptor.contextType === "taxpayer_identity"
          ? "identity"
          : `${parsed.planned.returnType}:${parsed.planned.period}`;
      const identityKey = `${descriptor.contextType}:${contextKey}:${descriptor.label}`;
      const existingInEntry = identityInEntry.get(identityKey);
      if (existingInEntry && existingInEntry.value !== leaf.value) {
        throw new SyntaxError("Inconsistent taxpayer identity in filed-return summary source.");
      }
      if (!existingInEntry || compareCodeUnits(leaf.path, existingInEntry.fieldPath) < 0) {
        identityInEntry.set(identityKey, {
          contextKey,
          contextType: descriptor.contextType,
          fieldPath: leaf.path,
          label: descriptor.label,
          value: leaf.value,
        });
      }
    }
    for (const identity of identityInEntry.values()) {
      const target =
        identity.contextType === "taxpayer_identity"
          ? taxpayerIdentityByLabel
          : returnIdentityByKey;
      const targetKey =
        identity.contextType === "taxpayer_identity"
          ? identity.label
          : `${identity.contextKey}:${identity.label}`;
      const existing = target.get(targetKey);
      if (existing && existing.value !== identity.value) {
        throw new SyntaxError("Inconsistent taxpayer identity in filed-return summary source.");
      }
      if (!existing || compareCodeUnits(identity.fieldPath, existing.fieldPath) < 0) {
        target.set(targetKey, identity);
      }
    }
  }
  return [...taxpayerIdentityByLabel.values(), ...returnIdentityByKey.values()];
}

function outcomeRow(
  planned: FiledReturnsSummaryPlanEntry,
  outcome: string,
): FiledReturnsSummaryDataRow {
  return {
    period: planned.period,
    returnType: planned.returnType,
    artifact: planned.artifactType,
    outcome,
    fieldLabel: "",
    fieldPath: OUTCOME_FIELD_PATH,
  };
}

function buildContextRows(
  plan: readonly FiledReturnsSummaryPlanEntry[],
  identityValues: readonly SummaryIdentityValue[],
): FiledReturnsSummaryContextRow[] {
  const financialYears = sortedUnique(plan.map((entry) => entry.financialYear));
  if (financialYears.length !== 1) {
    throw new SyntaxError("Filed-return summary plan must have one financial year.");
  }
  const identities = [...identityValues]
    .sort(
      (left, right) =>
        compareCodeUnits(left.contextType, right.contextType) ||
        compareCodeUnits(left.contextKey, right.contextKey) ||
        compareCodeUnits(left.label, right.label),
    )
    .map((identity) => ({
      contextType: identity.contextType,
      contextKey: identity.contextKey,
      fieldLabel: identity.label,
      fieldPath: identity.fieldPath,
      valueText: identity.value,
    }));
  return identities;
}

function dataCsvRow(row: FiledReturnsSummaryDataRow): Record<string, CsvCellValue> {
  return {
    period: row.period,
    return_type: row.returnType,
    artifact: row.artifact,
    outcome: row.outcome,
    field_label: row.fieldLabel,
    field_path: row.fieldPath,
    value_text: row.valueText === "" ? csvEmptyString() : row.valueText,
    value_number: row.valueNumber === undefined ? undefined : csvNumberText(row.valueNumber),
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

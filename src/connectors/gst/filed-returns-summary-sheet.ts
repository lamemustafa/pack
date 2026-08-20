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
  type FlatJsonArrayExpansionOptions,
  type FlatJsonLeaf,
} from "../../core/json-flat-table";
import { filedReturnsJsonDocumentContract } from "./artifact-validation";
import type { FiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import { filedReturnsSummaryFieldLabel } from "./filed-returns-summary-labels";
import {
  filedReturnsSummaryIdentity,
  filedReturnsRequiredWorkbookIdentityPaths,
  isFiledReturnsCanonicalIdentityPath,
  isFiledReturnsSummaryIdentityPath,
} from "./filed-returns-summary-identity";
import { isFiledReturnsSummaryForbiddenFieldPath } from "./filed-returns-summary-redaction";
import { FILED_RETURNS_MONTHS, type FiledReturnsMonth } from "./filed-returns-scope";

export const FILED_RETURNS_SUMMARY_SHEET_PATH = "full-year-summary.csv";
export const MAX_FILED_RETURNS_SUMMARY_ROWS = 100_000;
export const MAX_FILED_RETURNS_SUMMARY_ARRAY_EXPANSION_ELEMENTS = 64;

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

export class FiledReturnsSummaryForbiddenFieldError extends SyntaxError {}
export class FiledReturnsSummaryInvalidGstinError extends SyntaxError {}
export class FiledReturnsSummaryUncanonicalIdentityError extends SyntaxError {}

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
const DISCRIMINATOR_KEYS = ["ty", "pos"] as const;
const GSTR3B_EXPANDABLE_ARRAY_PATHS = [
  "/itc_elg/itc_avl",
  "/itc_elg/itc_rev",
  "/itc_elg/itc_inelg",
  "/inter_sup/unreg_details",
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
          includePath: (path, scalarKind) =>
            scalarKind === "string" && filedReturnsSummaryIdentity(path) !== null,
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
    // Path-based redaction cannot cover every alias a portal might use, so the
    // taxpayer's own identifier under an unrecognised field name would reach
    // value_text. It is withheld by value as well as by path.
    //
    // Deliberately scoped to *this document's own* identity rather than any
    // GSTIN-shaped text. A counterparty GSTIN is business data the summary
    // exists to report -- across 120 captured documents there are 3,171 such
    // values, all `ctin`, and withholding them would empty the most useful
    // column of a GSTR-2B CSV while withholding nothing the user does not
    // already hold in the original artifact beside it.
    const ownIdentityValues = new Set(
      parsed.identityLeaves
        .filter(
          (leaf) => filedReturnsSummaryIdentity(leaf.path)?.contextType === "taxpayer_identity",
        )
        .map((leaf) => leaf.value)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        // Compared case-insensitively: the portal's casing is not guaranteed to
        // be repeated under an unrecognised alias, and an identifier differing
        // only in case is the same identifier.
        .map((value) => value.toUpperCase()),
    );
    const fieldLeaves = parsed.leaves.filter(
      (leaf) =>
        !isFiledReturnsSummaryIdentityPath(leaf.path) &&
        !hasIdentityShapedPathSegment(leaf.path) &&
        !(leaf.valueKind === "text" && ownIdentityValues.has(leaf.value.toUpperCase())),
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
        fieldLabel: filedReturnsSummaryFieldLabel(parsed.planned.returnType, leaf.path, {
          financialYear: parsed.planned.financialYear,
          period: parsed.planned.period,
        }),
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
    // Bind the requirement to the canonical response path, not to the label
    // turning up anywhere in the document: a decoy `gstin` beside the envelope
    // would otherwise satisfy it and the workbook would attribute this return's
    // figures to an identity the portal never filed it under.
    for (const [requiredLabel, canonicalPath] of filedReturnsRequiredWorkbookIdentityPaths(
      parsed.planned.returnType,
    )) {
      const canonicalIdentity = parsed.identityLeaves.find((leaf) =>
        isFiledReturnsCanonicalIdentityPath(leaf.path, canonicalPath),
      );
      if (!canonicalIdentity || canonicalIdentity.value.trim() === "") {
        throw new FiledReturnsSummaryUncanonicalIdentityError(
          "Required taxpayer identity is missing from its canonical filed-return response path.",
        );
      }
      if (requiredLabel === "GSTIN" && !isValidGstin(canonicalIdentity.value)) {
        throw new FiledReturnsSummaryInvalidGstinError(
          "GSTIN is invalid in a parseable filed-return summary source.",
        );
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

// Mirrors the public GST Portal common validation bundle: a 15-character GSTIN
// shape plus the portal's base-36 check character. It validates only the
// taxpayer identity that Pack would otherwise place in the derived workbook.
const GSTIN_FORMAT = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz1-9A-Ja-j][0-9A-Za-z]$/;
const GSTIN_CHECK_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function isValidGstin(value: string): boolean {
  if (!GSTIN_FORMAT.test(value)) return false;
  const prefix = value.slice(0, 14);
  let factor = 2;
  let sum = 0;
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const codePoint = GSTIN_CHECK_CHARACTERS.indexOf(prefix[index]!.toUpperCase());
    if (codePoint < 0) return false;
    const digit = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    sum +=
      Math.floor(digit / GSTIN_CHECK_CHARACTERS.length) + (digit % GSTIN_CHECK_CHARACTERS.length);
  }
  const checkCodePoint =
    (GSTIN_CHECK_CHARACTERS.length - (sum % GSTIN_CHECK_CHARACTERS.length)) %
    GSTIN_CHECK_CHARACTERS.length;
  return value === `${prefix}${GSTIN_CHECK_CHARACTERS[checkCodePoint]}`;
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

// A discriminator value becomes a path segment and its own leaf is dropped, so
// anything embedded there escapes field-name-based redaction. Each key is
// constrained to its own observed shape rather than one shared pattern: a
// pattern loose enough for both `ty` and `pos` also admits values that are
// neither, such as a six-digit code. `pos` is a two-digit state code and `ty` is
// an uppercase mnemonic, across every captured document.
//
// This constrains shape, not vocabulary. The captured corpus is a single
// taxpayer, so it cannot establish the complete set of state codes another
// taxpayer would produce; asserting one would break them.
const FILED_RETURNS_DISCRIMINATOR_SHAPES: Readonly<Record<string, RegExp>> = {
  pos: /^[0-9]{2}$/,
  ty: /^[A-Z]{2,8}$/,
};

function isSafeFiledReturnsDiscriminatorValue(key: string, value: string): boolean {
  const shape = FILED_RETURNS_DISCRIMINATOR_SHAPES[key];
  if (!shape || !shape.test(value)) return false;
  return !isIdentityShapedSegment(value);
}

// A GSTIN or PAN can also arrive as an ordinary object key, which the flattener
// copies into the path verbatim. Alias-name redaction cannot see that, so the
// shape is refused wherever a decoded segment carries it.
const PAN_SHAPE = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;

function isIdentityShapedSegment(segment: string): boolean {
  return PAN_SHAPE.test(segment) || isValidGstin(segment);
}

export function hasIdentityShapedPathSegment(path: string): boolean {
  return path
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
    .some(isIdentityShapedSegment);
}

function filedReturnsSummaryArrayExpansion(
  returnType: FiledReturnsReturnType,
): FlatJsonArrayExpansionOptions {
  return {
    discriminatorKeys: DISCRIMINATOR_KEYS,
    isSafeDiscriminatorValue: isSafeFiledReturnsDiscriminatorValue,
    eligiblePaths: returnType === "GSTR-3B" ? GSTR3B_EXPANDABLE_ARRAY_PATHS : [],
    maxElements: MAX_FILED_RETURNS_SUMMARY_ARRAY_EXPANSION_ELEMENTS,
  };
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

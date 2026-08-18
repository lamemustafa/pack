import { isFiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import type { FiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import { FILED_RETURNS_MONTHS, isFiledReturnsFinancialYear } from "./filed-returns-scope";
import {
  isPackOffscreenBlobUrlMessageShape,
  type PackOffscreenBlobUrlMessage,
  type PackOffscreenFiledReturnZipExpectedEntry,
} from "./offscreen-blob-url";
import { isCanonicalFiledReturnsLedgerId } from "./filed-returns-ledger-id";
import type { FiledReturnsSummaryPlanEntry } from "./filed-returns-summary-sheet";

export { isCanonicalFiledReturnsLedgerId } from "./filed-returns-ledger-id";

export function isPackOffscreenBlobUrlMessage(
  input: unknown,
): input is PackOffscreenBlobUrlMessage {
  if (!isPackOffscreenBlobUrlMessageShape(input)) return false;

  if (input.type === "PACK_OFFSCREEN_STAGE_FILED_RETURN") {
    return (
      isCanonicalFiledReturnsLedgerId(input.payload.ledgerId) &&
      isCanonicalFiledReturnZipEntryName(input.payload.zipPath, input.payload.returnType) &&
      artifactTypeFromZipEntryName(input.payload.zipPath) === input.payload.artifactType
    );
  }

  if (input.type === "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP") {
    return (
      isCanonicalFiledReturnsLedgerId(input.payload.ledgerId) &&
      isExpectedZipEntryPlan(input.payload.expectedEntries, input.payload.expectedReturnType) &&
      input.payload.expectedEntries.length === input.payload.expectedEntryCount &&
      (input.payload.summaryPlan === undefined ||
        isSummaryPlan(
          input.payload.summaryPlan,
          input.payload.expectedEntries,
          input.payload.expectedReturnType,
        ))
    );
  }

  if (input.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER") {
    return isCanonicalFiledReturnsLedgerId(input.payload.ledgerId);
  }

  return true;
}

function isSummaryPlan(
  plan: readonly FiledReturnsSummaryPlanEntry[],
  expectedEntries: readonly PackOffscreenFiledReturnZipExpectedEntry[],
  expectedReturnType: FiledReturnsReturnType,
): boolean {
  const expectedSlots = new Set(
    expectedEntries.map((entry) => `${entry.artifactType}:${entry.entryNames.join("|")}`),
  );
  const plannedStagedSlots = new Set<string>();
  const identities = new Set<string>();
  const financialYears = new Set<string>();
  for (const entry of plan) {
    const identity = `${entry.period}:${entry.returnType}:${entry.artifactType}`;
    const staged = entry.outcomeCategory === "staged";
    const slot = `${entry.artifactType}:${entry.entryNames.join("|")}`;
    if (
      identities.has(identity) ||
      entry.returnType !== expectedReturnType ||
      !isFiledReturnsFinancialYear(entry.financialYear) ||
      !FILED_RETURNS_MONTHS.includes(entry.period) ||
      (staged && (entry.entryNames.length < 1 || !expectedSlots.has(slot))) ||
      (staged &&
        entry.entryNames.some((entryName) => !entryNameMatchesPeriod(entryName, entry.period))) ||
      (!staged && entry.entryNames.length !== 0) ||
      (staged && plannedStagedSlots.has(slot))
    ) {
      return false;
    }
    identities.add(identity);
    financialYears.add(entry.financialYear);
    if (staged) plannedStagedSlots.add(slot);
  }
  return (
    financialYears.size === 1 &&
    plannedStagedSlots.size === expectedSlots.size &&
    [...expectedSlots].every((slot) => plannedStagedSlots.has(slot))
  );
}

function entryNameMatchesPeriod(entryName: string, period: string): boolean {
  const prefix = period.toLowerCase();
  return entryName.startsWith(`${prefix}.`) || entryName.startsWith(`${prefix}-`);
}

export function isCanonicalFiledReturnZipEntryName(
  value: unknown,
  returnType?: FiledReturnsReturnType,
): value is string {
  if (typeof value !== "string") return false;
  const match = /^([a-z]+)(?:-(summary|details|data|return))?\.(pdf|xls|xlsx|json)$/.exec(value);
  return Boolean(
    match &&
    FILED_RETURNS_MONTHS.some((period) => period.toLowerCase() === match[1]) &&
    (match[2] !== "return" || (match[3] === "pdf" && returnType === "GSTR-3B")),
  );
}

function isExpectedZipEntryPlan(
  input: readonly PackOffscreenFiledReturnZipExpectedEntry[],
  expectedReturnType: FiledReturnsReturnType,
): boolean {
  const entryNames = new Set<string>();
  for (const candidate of input) {
    if (
      !isFiledReturnsConcreteArtifactType(candidate.artifactType) ||
      candidate.entryNames.some(
        (entryName) =>
          !isCanonicalFiledReturnZipEntryName(entryName, expectedReturnType) ||
          artifactTypeFromZipEntryName(entryName) !== candidate.artifactType ||
          entryNames.has(entryName),
      )
    ) {
      return false;
    }
    for (const entryName of candidate.entryNames) entryNames.add(entryName);
  }
  return true;
}

function artifactTypeFromZipEntryName(zipPath: string): FiledReturnsConcreteArtifactType | null {
  const lowerPath = zipPath.toLowerCase();
  if (lowerPath.endsWith(".pdf")) return "PDF";
  if (lowerPath.endsWith(".xls") || lowerPath.endsWith(".xlsx")) return "EXCEL";
  if (lowerPath.endsWith(".json")) return "JSON";
  return null;
}

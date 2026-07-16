import type { FiledReturnsDownloadScope } from "../../core/contracts";
import { matchesAcceptedText } from "./filed-returns-dom";
import { canonicalFiledReturnsMonth } from "./filed-returns-months";

export type ResultIdentityMatch = "absent" | "conflict" | "match";

export function filterBoundResultIdentityMatchesScope(
  text: string,
  scope: FiledReturnsDownloadScope,
): boolean {
  const financialYearEvidence = extractFinancialYearEvidence(text);
  const periodEvidence = extractExplicitPeriodEvidence(text, false);
  return (
    returnIdentityMatchesScope(text, scope) &&
    financialYearEvidence.valid &&
    financialYearEvidence.values.every((financialYear) => financialYear === scope.financialYear) &&
    periodEvidence.valid &&
    periodEvidence.values.every((period) => period === scope.period)
  );
}

export function resultRowPeriodMatch(
  explicitPeriod: string | null,
  rowText: string,
  scope: FiledReturnsDownloadScope,
): { period: string | null; state: ResultIdentityMatch } {
  const evidence = extractExplicitPeriodEvidence(rowText, scope.returnType !== "GSTR-1");
  if (!evidence.valid || evidence.values.some((period) => period !== scope.period)) {
    return { period: null, state: "conflict" };
  }
  const canonicalExplicitPeriod = canonicalFiledReturnsMonth(explicitPeriod);
  const explicitPeriodValues = extractMonthValues(explicitPeriod);
  if (explicitPeriod && !canonicalExplicitPeriod && explicitPeriodValues.length === 0) {
    return { period: null, state: "conflict" };
  }
  if (
    explicitPeriodValues.some((period) => period !== scope.period) ||
    (canonicalExplicitPeriod && canonicalExplicitPeriod !== scope.period)
  ) {
    return {
      period: canonicalExplicitPeriod ?? explicitPeriodValues[0] ?? null,
      state: "conflict",
    };
  }
  const period = canonicalExplicitPeriod ?? explicitPeriodValues[0] ?? evidence.values[0] ?? null;
  return { period, state: period ? "match" : "absent" };
}

export function resultRowFinancialYearMatch(
  explicitFinancialYear: string | null,
  rowText: string,
  scope: FiledReturnsDownloadScope,
): ResultIdentityMatch {
  if (hasMalformedLabeledFinancialYear(rowText)) return "conflict";
  const rowEvidence = extractFinancialYearEvidence(rowText);
  if (
    !rowEvidence.valid ||
    rowEvidence.values.some((financialYear) => financialYear !== scope.financialYear)
  ) {
    return "conflict";
  }
  if (rowEvidence.values.length > 0) return "match";
  if (explicitFinancialYear) {
    const evidence = extractFinancialYearEvidence(explicitFinancialYear);
    if (evidence.values.length > 0) {
      return evidence.valid &&
        evidence.values.every((financialYear) => financialYear === scope.financialYear)
        ? "match"
        : "conflict";
    }
    return matchesAcceptedText(explicitFinancialYear, [scope.financialYear]) ? "match" : "conflict";
  }
  return matchesAcceptedText(rowText, [scope.financialYear]) ? "match" : "absent";
}

export function canonicalResultRowPeriod(period: string | null): string | null {
  return canonicalFiledReturnsMonth(period);
}

function extractExplicitPeriodEvidence(
  text: string,
  allowQuarterlyCadence: boolean,
): { valid: boolean; values: string[] } {
  const matches = Array.from(
    text.matchAll(/\b(?:(?:return|tax)\s*(?:filing\s*)?period|month)\b\s*(?:[-:]\s*)?/gi),
  );
  const values: string[] = [];
  let valid = true;
  for (const match of matches) {
    const valueStart = (match.index ?? 0) + match[0].length;
    const fieldValue =
      text
        .slice(valueStart)
        .split(
          /\b(?:financial\s*year|fy|return\s*type|status|filed(?:\s+on)?|view|acknowledg(?:e)?ment)\b/i,
          1,
        )[0] ?? "";
    const rawValues = Array.from(fieldValue.matchAll(/\b[a-z]+\b/gi)).map((value) =>
      value[0].toLowerCase(),
    );
    const periods = rawValues.flatMap((rawValue) => {
      const period = canonicalFiledReturnsMonth(rawValue);
      return period ? [period] : [];
    });
    values.push(...periods);
    const cadenceValues = rawValues.filter((value) => value === "monthly" || value === "quarterly");
    if (
      periods.length === 0 &&
      !cadenceValues.includes("monthly") &&
      !(allowQuarterlyCadence && cadenceValues.includes("quarterly"))
    ) {
      valid = false;
    }
    if (!allowQuarterlyCadence && cadenceValues.includes("quarterly")) valid = false;
  }
  return { valid, values };
}

function extractMonthValues(text: string | null): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(/\b[a-z]+\b/gi)).flatMap((match) => {
    const period = canonicalFiledReturnsMonth(match[0]);
    return period ? [period] : [];
  });
}

function extractFinancialYearEvidence(text: string): { valid: boolean; values: string[] } {
  const labeledMatches = Array.from(
    text.matchAll(
      /\b(?:financial\s*year|fy)\b\s*(?:[-:]\s*)?(20\d{2})\s*[-\u2013/]\s*(\d{2}|\d{4})(?!\d)/gi,
    ),
  );
  const bareMatches = Array.from(
    text.matchAll(/\b(20\d{2})\s*[-\u2013/]\s*(\d{2}|\d{4})(?!\d|\s*[-/]\s*\d)/g),
  );
  const matches = [...labeledMatches, ...bareMatches];
  const values = matches
    .map((match) => canonicalFinancialYear(match[1], match[2]))
    .filter((financialYear): financialYear is string => Boolean(financialYear));
  return { valid: values.length === matches.length, values };
}

function hasMalformedLabeledFinancialYear(text: string): boolean {
  return Array.from(
    text.matchAll(
      /\b(?:financial\s*year|fy)\b\s*(?:[-:]\s*)?(20\d{2})\s*[-\u2013/]\s*(\d{2}|\d{4})(?!\d)/gi,
    ),
  ).some((match) => !canonicalFinancialYear(match[1], match[2]));
}

function canonicalFinancialYear(
  startYear: string | undefined,
  rawEndYear: string | undefined,
): string | null {
  if (!startYear || !rawEndYear) return null;
  const expectedEndYear = Number(startYear) + 1;
  if (rawEndYear.length === 4 && Number(rawEndYear) !== expectedEndYear) return null;
  const endYear = rawEndYear.length === 4 ? rawEndYear.slice(2) : rawEndYear;
  return Number(endYear) === expectedEndYear % 100 ? `${startYear}-${endYear}` : null;
}

export function returnIdentityMatchesScope(
  text: string,
  scope: FiledReturnsDownloadScope,
): boolean {
  if (!matchesAcceptedText(text, [scope.returnType])) return false;
  const identities = Array.from(text.matchAll(/\bgstr\s*[-]?\s*(\d+[a-z]?)\b/gi)).flatMap(
    (match) => (match[1] ? [match[1].toLowerCase()] : []),
  );
  const acceptedIdentities =
    scope.returnType === "GSTR-1"
      ? new Set(["1", "1a"])
      : new Set([scope.returnType.replace("GSTR-", "").toLowerCase()]);
  return identities.length > 0 && identities.every((identity) => acceptedIdentities.has(identity));
}

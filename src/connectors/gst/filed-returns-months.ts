import type { FiledReturnsDownloadScope } from "../../core/contracts";

export const FILED_RETURNS_MONTHS = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
] as const;

const MONTH_ALIASES: Record<string, string[]> = {
  april: ["April", "Apr"],
  may: ["May"],
  june: ["June", "Jun"],
  july: ["July", "Jul"],
  august: ["August", "Aug"],
  september: ["September", "Sep", "Sept"],
  october: ["October", "Oct"],
  november: ["November", "Nov"],
  december: ["December", "Dec"],
  january: ["January", "Jan"],
  february: ["February", "Feb"],
  march: ["March", "Mar"],
};

const CANONICAL_MONTH_BY_ALIAS = new Map(
  Object.entries(MONTH_ALIASES).flatMap(([canonicalKey, aliases]) => {
    const canonical = FILED_RETURNS_MONTHS.find(
      (month) => normaliseMonthText(month) === canonicalKey,
    );
    return canonical ? aliases.map((alias) => [normaliseMonthText(alias), canonical] as const) : [];
  }),
);

export function acceptedFiledReturnsMonthTexts(period: string): string[] {
  return MONTH_ALIASES[period.toLowerCase()] ?? [period];
}

export function acceptedFiledReturnsPeriodTexts(scope: FiledReturnsDownloadScope): string[] {
  return acceptedFiledReturnsMonthTexts(scope.period);
}

export function canonicalFiledReturnsMonth(value: string | null | undefined): string | null {
  if (!value) return null;
  return CANONICAL_MONTH_BY_ALIAS.get(normaliseMonthText(value)) ?? null;
}

function normaliseMonthText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

import type { FiledReturnsDownloadScope } from "../../core/contracts";

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

export function acceptedFiledReturnsMonthTexts(period: string): string[] {
  return MONTH_ALIASES[period.toLowerCase()] ?? [period];
}

export function acceptedFiledReturnsPeriodTexts(scope: FiledReturnsDownloadScope): string[] {
  return acceptedFiledReturnsMonthTexts(scope.period);
}

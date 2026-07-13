import type { FiledReturnsDownloadScope } from "../core/contracts";

export interface MainWorldFiledReturnsFilterSelectionOutcome {
  state: "searched" | "waiting" | "unavailable";
  safeSignals: string[];
}

/**
 * Runs in the GST page's main world. It intentionally returns only control-state
 * signals; option labels, page content, and portal data never leave the page.
 */
export async function selectFiledReturnsFiltersInMainWorld(
  scope: FiledReturnsDownloadScope,
): Promise<MainWorldFiledReturnsFilterSelectionOutcome> {
  const filterTimeoutMs = 15_000;
  const filterPollMs = 250;
  const normalise = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const comparable = (value: string) => normalise(value).replace(/[^a-z0-9]/g, "");
  const matches = (value: string, accepted: readonly string[]) => {
    const candidate = comparable(value);
    return accepted.some((item) => {
      const expected = comparable(item);
      if (candidate === expected || !expected) return candidate === expected;
      let index = candidate.indexOf(expected);
      while (index >= 0) {
        const followingCharacter = candidate[index + expected.length] ?? "";
        if (!/\d$/.test(expected) || !/^\d$/.test(followingCharacter)) return true;
        index = candidate.indexOf(expected, index + 1);
      }
      return false;
    });
  };
  const leaveFilingPeriodUnselectedPattern =
    /please\s+do\s+not\s+select\s+any\s+value\s+in\s+['"]?return\s+filing\s+period/i;
  const returnTypeInstructionPatterns: Record<FiledReturnsDownloadScope["returnType"], RegExp> = {
    "GSTR-1": /\bgstr\s*[- ]?\s*1\b/i,
    "GSTR-3B": /\bgstr\s*[- ]?\s*3b\b/i,
    "GSTR-2B": /\bgstr\s*[- ]?\s*2b\b/i,
  };
  const returnTypeInstructionPattern = returnTypeInstructionPatterns[scope.returnType];
  const leaveFilingPeriodUnselected = Array.from(
    document.querySelectorAll<HTMLElement>("p, li, [role='note'], [role='alert']"),
  ).some((element) => {
    const instructionText = element.innerText || element.textContent || "";
    return (
      leaveFilingPeriodUnselectedPattern.test(instructionText) &&
      returnTypeInstructionPattern.test(instructionText)
    );
  });
  const findSelect = (kind: "financial-year" | "filing-period" | "month" | "return-type") => {
    const patterns = {
      "financial-year": /\bfinyr\b|financial\s*year|financialyear/i,
      "filing-period": /\boptvalue\b|filing\s*period|filingperiod/i,
      month: /\bmonth\b|\bmth\b/i,
      "return-type": /\brettyp\b|return\s*type|gstvalue|gsttype/i,
    } as const;
    return (
      Array.from(document.querySelectorAll("select"))
        .filter((select) => {
          const style = window.getComputedStyle(select);
          return !select.disabled && style.display !== "none" && style.visibility !== "hidden";
        })
        .find((select) =>
          patterns[kind].test(
            [
              select.id,
              select.name,
              select.title,
              select.getAttribute("aria-label") ?? "",
              select.getAttribute("data-ng-model") ?? "",
              select.getAttribute("ng-model") ?? "",
            ].join(" "),
          ),
        ) ?? null
    );
  };
  const selectOption = async (
    kind: "financial-year" | "filing-period" | "month" | "return-type",
    accepted: readonly string[],
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < filterTimeoutMs) {
      const select = findSelect(kind);
      if (!select) {
        await new Promise((resolve) => setTimeout(resolve, filterPollMs));
        continue;
      }
      const selected = select.selectedOptions[0];
      if (selected && matches(selected.textContent || select.value, accepted)) return true;
      const option = Array.from(select.options).find((candidate) =>
        matches(candidate.textContent || candidate.value, accepted),
      );
      if (option) {
        select.focus({ preventScroll: true });
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set;
        nativeSetter?.call(select, option.value);
        select.selectedIndex = option.index;
        for (const eventName of ["input", "change"]) {
          select.dispatchEvent(new Event(eventName, { bubbles: true, composed: true }));
        }
        select.blur();
        if (matches(select.selectedOptions[0]?.textContent || select.value, accepted)) return true;
      }
      await new Promise((resolve) => setTimeout(resolve, filterPollMs));
    }
    return false;
  };
  const selectedOptionMatches = (
    kind: "financial-year" | "filing-period" | "month" | "return-type",
    accepted: readonly string[],
  ) => {
    const select = findSelect(kind);
    return Boolean(
      select && matches(select.selectedOptions[0]?.textContent || select.value, accepted),
    );
  };

  const financialYearSelected = await selectOption("financial-year", [scope.financialYear]);
  if (!financialYearSelected) {
    return { state: "waiting", safeSignals: ["main-world-financial-year-not-ready"] };
  }

  const filingPeriodSelected =
    leaveFilingPeriodUnselected || (await selectOption("filing-period", ["Monthly", scope.period]));
  if (!filingPeriodSelected) {
    return { state: "waiting", safeSignals: ["main-world-filing-period-not-ready"] };
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const returnTypeSelected = await selectOption("return-type", [scope.returnType]);
  if (!returnTypeSelected) {
    return { state: "waiting", safeSignals: ["main-world-return-type-not-ready"] };
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const monthAliases: Record<string, string[]> = {
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
  const acceptedMonths = monthAliases[normalise(scope.period)] ?? [scope.period];
  const monthSelect = findSelect("month");
  const monthSelected = !monthSelect || (await selectOption("month", acceptedMonths));
  if (!monthSelected) {
    return { state: "waiting", safeSignals: ["main-world-month-not-ready"] };
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const currentMonthSelect = findSelect("month");
  const filtersStable =
    selectedOptionMatches("financial-year", [scope.financialYear]) &&
    (leaveFilingPeriodUnselected ||
      selectedOptionMatches("filing-period", ["Monthly", scope.period])) &&
    selectedOptionMatches("return-type", [scope.returnType]) &&
    (monthSelect
      ? Boolean(currentMonthSelect) && selectedOptionMatches("month", acceptedMonths)
      : !currentMonthSelect);
  if (!filtersStable) {
    return { state: "waiting", safeSignals: ["main-world-filter-selection-unstable"] };
  }

  const search = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, input[type='button'], input[type='submit'], [role='button']",
    ),
  ).find(
    (element) =>
      normalise(element.innerText || element.textContent || element.getAttribute("value") || "") ===
      "search",
  );
  if (!search) return { state: "unavailable", safeSignals: ["main-world-search-not-found"] };

  search.click();
  return {
    state: "searched",
    safeSignals: [
      "main-world-financial-year-selected",
      ...(leaveFilingPeriodUnselected ? ["return-filing-period-left-unselected"] : []),
      ...(monthSelect ? ["main-world-month-selected"] : []),
      "main-world-return-type-selected",
      "main-world-search-clicked",
    ],
  };
}

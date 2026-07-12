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
      return candidate === expected || candidate.includes(expected);
    });
  };
  const pageText = document.body?.innerText ?? document.body?.textContent ?? "";
  const leaveFilingPeriodUnselected =
    /please\s+do\s+not\s+select\s+any\s+value\s+in\s+['"]?return\s+filing\s+period/i.test(pageText);
  const findSelect = (kind: "financial-year" | "filing-period" | "return-type") => {
    const patterns = {
      "financial-year": /\bfinyr\b|financial\s*year|financialyear/i,
      "filing-period": /\boptvalue\b|filing\s*period|filingperiod/i,
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
    kind: "financial-year" | "filing-period" | "return-type",
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

  const financialYearSelected = await selectOption("financial-year", [scope.financialYear]);
  if (!financialYearSelected) {
    return { state: "waiting", safeSignals: ["main-world-financial-year-not-ready"] };
  }

  const filingPeriodSelected =
    leaveFilingPeriodUnselected || (await selectOption("filing-period", ["Monthly", scope.period]));
  if (!filingPeriodSelected) {
    return { state: "waiting", safeSignals: ["main-world-filing-period-not-ready"] };
  }

  const returnTypeSelected = await selectOption("return-type", [scope.returnType]);
  if (!returnTypeSelected) {
    return { state: "waiting", safeSignals: ["main-world-return-type-not-ready"] };
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
      "main-world-return-type-selected",
      "main-world-search-clicked",
    ],
  };
}

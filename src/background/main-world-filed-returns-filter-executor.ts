import { browser } from "wxt/browser";
import type { FiledReturnsDownloadScope } from "../core/contracts";
import {
  selectFiledReturnsFiltersInMainWorld,
  type MainWorldFiledReturnsFilterSelectionOutcome,
} from "./main-world-filed-returns-filter-selection";

export async function selectFiledReturnsFiltersInMainWorldForTab(
  tabId: number,
  scope: FiledReturnsDownloadScope,
): Promise<MainWorldFiledReturnsFilterSelectionOutcome> {
  try {
    const [result] = await browser.scripting.executeScript({
      args: [scope],
      func: selectFiledReturnsFiltersInMainWorld,
      target: { tabId },
      world: "MAIN",
    });
    if (isMainWorldFilterOutcome(result?.result)) return result.result;
  } catch {
    // The content-script path remains authoritative if main-world execution is unavailable.
  }
  return { state: "unavailable", safeSignals: ["main-world-filter-execution-unavailable"] };
}

function isMainWorldFilterOutcome(
  value: unknown,
): value is MainWorldFiledReturnsFilterSelectionOutcome {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MainWorldFiledReturnsFilterSelectionOutcome>;
  return (
    (candidate.state === "searched" ||
      candidate.state === "waiting" ||
      candidate.state === "unavailable") &&
    Array.isArray(candidate.safeSignals) &&
    candidate.safeSignals.every((signal) => typeof signal === "string")
  );
}

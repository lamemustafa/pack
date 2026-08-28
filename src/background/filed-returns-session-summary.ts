import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { parseDurableFiledReturnsFlowSummary } from "./filed-returns-durable-summary";

let summaryMutationCriticalSection = Promise.resolve();

export type FiledReturnsFlowSummaryStorageState =
  | { state: "missing" }
  | { state: "malformed" }
  | { reason: "storage-read-failed" | "storage-write-failed"; state: "unavailable" }
  | { state: "valid"; summary: FiledReturnsFlowSummary };

export async function persistCanonicalFiledReturnsFlowSummary(
  key: string,
  input: unknown,
): Promise<FiledReturnsFlowSummary | null> {
  return runSummaryMutationCriticalSection(() => writeCanonicalSummary(key, input));
}

export async function persistCanonicalSinglePeriodCompletion(
  key: string | undefined,
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  now: Date,
): Promise<FiledReturnsFlowSummary | null> {
  if (!key) return null;
  return persistCanonicalFiledReturnsFlowSummary(key, {
    scope,
    status: "complete",
    completedAt: now.toISOString(),
    completedPeriods: [scope.period],
    currentPeriod: scope.period,
    totalPeriods: 1,
    flowStep,
  });
}

export async function readCanonicalFiledReturnsFlowSummary(
  key: string,
): Promise<FiledReturnsFlowSummary | null> {
  return runSummaryMutationCriticalSection(async () => {
    const values = await browser.storage.session.get(key);
    const input = values[key];
    if (input === undefined || input === null) return null;
    return writeCanonicalSummary(key, input);
  });
}

export async function readCanonicalFiledReturnsFlowSummaryStorageState(
  key: string,
  malformedReplacement: FiledReturnsFlowSummary,
): Promise<FiledReturnsFlowSummaryStorageState> {
  return runSummaryMutationCriticalSection(async () => {
    const canonicalMalformedReplacement = parseDurableFiledReturnsFlowSummary(malformedReplacement);
    if (!canonicalMalformedReplacement) {
      throw new Error("Invalid canonical malformed-summary replacement.");
    }
    let values: Record<string, unknown>;
    try {
      values = await browser.storage.session.get(key);
    } catch {
      return { reason: "storage-read-failed", state: "unavailable" };
    }
    const input = values[key];
    if (input === undefined || input === null) return { state: "missing" };
    const summary = parseDurableFiledReturnsFlowSummary(input);
    if (!summary) {
      try {
        await browser.storage.session.set({ [key]: canonicalMalformedReplacement });
      } catch {
        return { reason: "storage-write-failed", state: "unavailable" };
      }
      return { state: "malformed" };
    }
    try {
      await browser.storage.session.set({ [key]: summary });
    } catch {
      return { reason: "storage-write-failed", state: "unavailable" };
    }
    return { state: "valid", summary };
  });
}

async function writeCanonicalSummary(
  key: string,
  input: unknown,
): Promise<FiledReturnsFlowSummary | null> {
  const summary = parseDurableFiledReturnsFlowSummary(input);
  if (!summary) {
    await browser.storage.session.remove(key);
    return null;
  }
  await browser.storage.session.set({ [key]: summary });
  return summary;
}

async function runSummaryMutationCriticalSection<T>(action: () => Promise<T>): Promise<T> {
  const previous = summaryMutationCriticalSection;
  let release: () => void = () => undefined;
  summaryMutationCriticalSection = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

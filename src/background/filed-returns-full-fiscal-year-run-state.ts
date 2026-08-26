import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { isCleanedZipPhase } from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { normaliseFiledReturnsArtifactType } from "../connectors/gst/filed-returns-artifacts";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  canCompleteFullFiscalYearLedger,
  hasActionRequiredFullFiscalYearTarget,
  hasInconsistentFullFiscalYearCompletion,
  isFullFiscalYearLedger,
  isFullFiscalYearLedgerStale,
  recoverableFullFiscalYearLedgerId,
  sameFiledReturnsScope,
} from "./filed-returns-full-fiscal-year-ledger";
import {
  activeFullFiscalYearStep,
  blockedFullFiscalYearStep,
  downloadUnconfirmedFullFiscalYearStep,
  hasLegacyRetainedStaging,
  interruptedFullFiscalYearStep,
  needsResumeConfirmation,
  summariseFullFiscalYearLedger,
  toFullFiscalYearSummary,
} from "./filed-returns-full-fiscal-year-summary";
import { persistCanonicalFiledReturnsFlowSummary } from "./filed-returns-session-summary";

export function hasTerminalPositiveTarget(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return ledger.targets.some((target) =>
    ["downloaded", "manually-observed", "not-filed"].includes(target.status),
  );
}

export function hasDownloadUnconfirmedTarget(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return ledger.targets.some((target) => target.status === "download-unconfirmed");
}

export function hasRetainedFullFiscalYearStaging(
  ledger: FiledReturnsFullFiscalYearLedger,
): boolean {
  if (isCleanedZipPhase(ledger.zipPhase)) return false;
  if (ledger.zipPhase !== undefined) return true;
  if (hasLegacyRetainedStaging(ledger)) return true;
  return ledger.targets.some((target) =>
    target.safeSignals.some(
      (signal) =>
        signal === "full-fiscal-year-opfs-staged" ||
        signal.startsWith("full-fiscal-year-opfs-staged:"),
    ),
  );
}

export function responseForExistingLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  options: { allowExistingLedgerResume?: boolean; blockRetainedStaging?: boolean } = {},
): PackMessageResponse | null {
  if (hasInconsistentFullFiscalYearCompletion(ledger)) {
    const summary = summariseFullFiscalYearLedger(ledger, now);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }
  if (options.blockRetainedStaging && hasRetainedFullFiscalYearStaging(ledger)) {
    const step = retainedStagingScopeConflictStep(ledger);
    return { ok: true, flowStep: step, flowSummary: toFullFiscalYearSummary(ledger, step) };
  }

  const unconfirmedDownload = ledger.targets.some(
    (target) => target.status === "download-unconfirmed",
  );
  if (unconfirmedDownload) {
    const step = downloadUnconfirmedFullFiscalYearStep(ledger);
    return { ok: true, flowStep: step, flowSummary: toFullFiscalYearSummary(ledger, step) };
  }

  if (ledger.status === "complete" && canCompleteFullFiscalYearLedger(ledger)) {
    const summary = summariseFullFiscalYearLedger(ledger);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  if (
    ledger.status === "running" &&
    ledger.targets.some((target) => target.status === "running") &&
    !isFullFiscalYearLedgerStale(ledger, now)
  ) {
    const summary = toFullFiscalYearSummary(ledger, activeFullFiscalYearStep(ledger));
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  if (
    ledger.status === "running" &&
    ledger.targets.some((target) => target.status === "running") &&
    isFullFiscalYearLedgerStale(ledger, now)
  ) {
    const displayLedger: FiledReturnsFullFiscalYearLedger = {
      ...ledger,
      status: "blocked",
      updatedAt: now.toISOString(),
    };
    const step = interruptedFullFiscalYearStep(displayLedger);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(displayLedger, step),
    };
  }

  const hasApprovedPendingRetry =
    options.allowExistingLedgerResume &&
    ledger.targets.some(
      (target) =>
        target.status === "pending" &&
        target.safeSignals.includes("full-fiscal-year-target-retry-approved"),
    );
  if (hasActionRequiredFullFiscalYearTarget(ledger) && !hasApprovedPendingRetry) {
    const summary = summariseFullFiscalYearLedger(ledger, now);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  if (!options.allowExistingLedgerResume && needsResumeConfirmation(ledger)) {
    const step = blockedFullFiscalYearStep("full-fiscal-year-resume-confirmation-required", ledger);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(ledger, step),
    };
  }

  return null;
}

function retainedStagingScopeConflictStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  const finalZipRetry = canCompleteFullFiscalYearLedger(ledger);
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(ledger.scope.returnType),
    state: "blocked",
    safeSignals: [
      "full-fiscal-year-retained-staging-scope-conflict",
      "full-fiscal-year-opfs-retained",
      ...(finalZipRetry ? ["full-fiscal-year-final-zip-retry"] : []),
    ],
    safeMessage: `Pack retained the FY ${ledger.scope.financialYear} run. Return to that saved selection and resolve it before starting another full-year selection.`,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Return to the saved full-year selection and resolve it first.",
      canResume: true,
    },
  };
}

export function shouldPersistReconciledLedger(
  previous: FiledReturnsFullFiscalYearLedger,
  reconciled: FiledReturnsFullFiscalYearLedger,
): boolean {
  return (
    (previous.revision ?? 1) !== (reconciled.revision ?? 1) ||
    previous.planVersion !== reconciled.planVersion ||
    previous.status !== reconciled.status ||
    previous.targets.length !== reconciled.targets.length ||
    previous.eligibleThrough !== reconciled.eligibleThrough ||
    previous.zipPhase !== reconciled.zipPhase ||
    previous.zipDownloadAttempt?.requestedAt !== reconciled.zipDownloadAttempt?.requestedAt ||
    previous.zipDownloadAttempt?.downloadId !== reconciled.zipDownloadAttempt?.downloadId ||
    previous.targets.some((target, index) => {
      const nextTarget = reconciled.targets[index];
      return (
        !nextTarget ||
        target.targetId !== nextTarget.targetId ||
        target.status !== nextTarget.status
      );
    })
  );
}

const PLAN_STORAGE_KEY_PREFIX = "pack:filed-returns-plan:";
const PLAN_INDEX_SCHEMA_VERSION = "1.0";

type PlanLedgerIndex = {
  schemaVersion: typeof PLAN_INDEX_SCHEMA_VERSION;
  ledgerIdsByScope: Record<string, string>;
};

type LedgerStorageDeps = {
  storageKeys: {
    fullFiscalYearLedger: string;
    fullFiscalYearLedgerIndex?: string;
  };
};

export type PlanLedgersStorageState =
  { state: "valid"; ledgers: FiledReturnsFullFiscalYearLedger[] } | { state: "malformed" };

export function filedReturnsPlanStorageKey(ledgerId: string): string {
  return `${PLAN_STORAGE_KEY_PREFIX}${ledgerId}`;
}

export async function readLedgerForScope(
  deps: LedgerStorageDeps,
  scope: FiledReturnsDownloadScope,
): Promise<FiledReturnsFullFiscalYearLedger | null> {
  const indexKey = deps.storageKeys.fullFiscalYearLedgerIndex;
  if (!indexKey) return readLedger(deps.storageKeys.fullFiscalYearLedger);
  const index = await readPlanLedgerIndex(indexKey);
  const ledgerId = index?.ledgerIdsByScope[planScopeKey(scope)];
  if (ledgerId) {
    const ledger = await readLedger(filedReturnsPlanStorageKey(ledgerId));
    return ledger?.ledgerId === ledgerId && sameFiledReturnsScope(ledger.scope, scope)
      ? ledger
      : null;
  }

  const legacy = await readLedger(deps.storageKeys.fullFiscalYearLedger);
  return legacy && sameFiledReturnsScope(legacy.scope, scope) ? legacy : null;
}

export async function readLedgerById(
  deps: LedgerStorageDeps,
  ledgerId: string,
): Promise<FiledReturnsFullFiscalYearLedger | null> {
  const ledger = await readLedger(filedReturnsPlanStorageKey(ledgerId));
  if (ledger?.ledgerId === ledgerId) return ledger;
  const legacy = await readLedger(deps.storageKeys.fullFiscalYearLedger);
  return legacy?.ledgerId === ledgerId ? legacy : null;
}

export async function readLedgerWithPendingZipDownload(
  deps: LedgerStorageDeps,
  downloadId?: number,
): Promise<FiledReturnsFullFiscalYearLedger | null> {
  const candidates = await readLedgersWithPendingZipDownload(deps, downloadId);
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

export async function readLedgersWithPendingZipDownload(
  deps: LedgerStorageDeps,
  downloadId?: number,
): Promise<FiledReturnsFullFiscalYearLedger[]> {
  const indexKey = deps.storageKeys.fullFiscalYearLedgerIndex;
  if (!indexKey) {
    const ledger = await readLedger(deps.storageKeys.fullFiscalYearLedger);
    return pendingZipLedgerMatches(ledger, downloadId) ? [ledger] : [];
  }
  const indexValues = await browser.storage.local.get(indexKey);
  if (indexValues[indexKey] === undefined || indexValues[indexKey] === null) {
    const ledger = await readLedger(deps.storageKeys.fullFiscalYearLedger);
    return pendingZipLedgerMatches(ledger, downloadId) ? [ledger] : [];
  }
  const index = parsePlanLedgerIndex(indexValues[indexKey]);
  if (!index) return [];
  return (
    await Promise.all(
      Object.entries(index.ledgerIdsByScope).map(async ([scopeKey, ledgerId]) => {
        const ledger = await readLedger(filedReturnsPlanStorageKey(ledgerId));
        return ledger?.ledgerId === ledgerId && planScopeKey(ledger.scope) === scopeKey
          ? ledger
          : null;
      }),
    )
  ).filter((ledger): ledger is FiledReturnsFullFiscalYearLedger =>
    pendingZipLedgerMatches(ledger, downloadId),
  );
}

export async function readPlanLedgersStorageState(
  deps: LedgerStorageDeps,
): Promise<PlanLedgersStorageState> {
  const indexKey = deps.storageKeys.fullFiscalYearLedgerIndex;
  if (!indexKey) return { state: "valid", ledgers: [] };
  const values = await browser.storage.local.get(null);
  const planKeys = Object.keys(values).filter((key) => key.startsWith(PLAN_STORAGE_KEY_PREFIX));
  const indexValue = values[indexKey];
  if (indexValue === undefined || indexValue === null) {
    return planKeys.length === 0 ? { state: "valid", ledgers: [] } : { state: "malformed" };
  }
  const index = parsePlanLedgerIndex(indexValue);
  if (!index) return { state: "malformed" };
  const ledgerIds = Object.values(index.ledgerIdsByScope);
  if (new Set(ledgerIds).size !== ledgerIds.length) return { state: "malformed" };
  const indexedPlanKeys = ledgerIds.map((ledgerId) => filedReturnsPlanStorageKey(ledgerId));
  if (
    indexedPlanKeys.length !== planKeys.length ||
    indexedPlanKeys.some((key) => !planKeys.includes(key))
  ) {
    return { state: "malformed" };
  }
  const ledgers = Object.entries(index.ledgerIdsByScope).map(([scopeKey, ledgerId]) => {
    const ledger = values[filedReturnsPlanStorageKey(ledgerId)];
    return isFullFiscalYearLedger(ledger) &&
      ledger.ledgerId === ledgerId &&
      planScopeKey(ledger.scope) === scopeKey
      ? ledger
      : null;
  });
  return ledgers.every((ledger): ledger is FiledReturnsFullFiscalYearLedger => ledger !== null)
    ? { state: "valid", ledgers }
    : { state: "malformed" };
}

/** Recovery must remain visible even when a separate index entry is malformed. */
export async function readRetainedPlanLedgers(
  deps: LedgerStorageDeps,
): Promise<FiledReturnsFullFiscalYearLedger[]> {
  if (!deps.storageKeys.fullFiscalYearLedgerIndex) {
    const legacy = await readLedger(deps.storageKeys.fullFiscalYearLedger);
    return legacy ? [legacy] : [];
  }
  const values = await browser.storage.local.get(null);
  return Object.entries(values)
    .filter(
      ([key]) =>
        key === deps.storageKeys.fullFiscalYearLedger || key.startsWith(PLAN_STORAGE_KEY_PREFIX),
    )
    .map(([, value]) => value)
    .filter(isFullFiscalYearLedger);
}

export async function readLedger(key: string): Promise<FiledReturnsFullFiscalYearLedger | null> {
  const values = await browser.storage.local.get(key);
  const ledger = values[key];
  return isFullFiscalYearLedger(ledger) ? ledger : null;
}

function pendingZipLedgerMatches(
  ledger: FiledReturnsFullFiscalYearLedger | null,
  downloadId: number | undefined,
): ledger is FiledReturnsFullFiscalYearLedger {
  return (
    ledger?.zipPhase === "download-observing" &&
    (downloadId === undefined || ledger.zipDownloadAttempt?.downloadId === downloadId)
  );
}

export async function readMalformedLedgerState(
  key: string,
): Promise<{ recoverableLedgerId: string | null } | null> {
  const values = await browser.storage.local.get(key);
  const ledger = values[key];
  if (ledger === undefined || ledger === null || isFullFiscalYearLedger(ledger)) return null;
  return { recoverableLedgerId: recoverableFullFiscalYearLedgerId(ledger) };
}

export async function persistLedger(
  deps: LedgerStorageDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
): Promise<void> {
  const indexKey = deps.storageKeys.fullFiscalYearLedgerIndex;
  if (!indexKey) {
    await browser.storage.local.set({ [deps.storageKeys.fullFiscalYearLedger]: ledger });
    return;
  }
  if ((await readPlanLedgersStorageState(deps)).state === "malformed") {
    throw new Error("Pack could not verify the saved plan index before saving this run.");
  }
  const index = (await readPlanLedgerIndex(indexKey)) ?? {
    schemaVersion: PLAN_INDEX_SCHEMA_VERSION,
    ledgerIdsByScope: {},
  };
  const scopeKey = planScopeKey(ledger.scope);
  const previousId = index.ledgerIdsByScope[scopeKey];
  if (previousId && previousId !== ledger.ledgerId) {
    const previous = await readLedger(filedReturnsPlanStorageKey(previousId));
    if (!previous || !canReplaceLedger(previous)) {
      throw new Error("Pack must resolve the saved plan before replacing this selection.");
    }
  }
  index.ledgerIdsByScope[scopeKey] = ledger.ledgerId;
  await browser.storage.local.set({
    [filedReturnsPlanStorageKey(ledger.ledgerId)]: ledger,
    [indexKey]: index,
  });
  if (previousId && previousId !== ledger.ledgerId) {
    await browser.storage.local.remove(filedReturnsPlanStorageKey(previousId));
  }
  await removeMatchingLegacyLedger(deps, ledger);
}

export async function removeLedger(
  deps: LedgerStorageDeps,
  ledger: Pick<FiledReturnsFullFiscalYearLedger, "ledgerId" | "scope">,
): Promise<void> {
  const indexKey = deps.storageKeys.fullFiscalYearLedgerIndex;
  if (!indexKey) {
    await removeMatchingLegacyLedger(deps, ledger);
    return;
  }
  const index = await readPlanLedgerIndex(indexKey);
  if (!index) {
    await browser.storage.local.remove(filedReturnsPlanStorageKey(ledger.ledgerId));
    await removeMatchingLegacyLedger(deps, ledger);
    return;
  }
  const scopeKey = planScopeKey(ledger.scope);
  if (index.ledgerIdsByScope[scopeKey] === ledger.ledgerId) {
    delete index.ledgerIdsByScope[scopeKey];
  }
  await browser.storage.local.remove(filedReturnsPlanStorageKey(ledger.ledgerId));
  await browser.storage.local.set({ [indexKey]: index });
  await removeMatchingLegacyLedger(deps, ledger);
}

async function removeMatchingLegacyLedger(
  deps: LedgerStorageDeps,
  ledger: Pick<FiledReturnsFullFiscalYearLedger, "ledgerId" | "scope">,
): Promise<void> {
  const legacy = await readLedger(deps.storageKeys.fullFiscalYearLedger);
  if (legacy?.ledgerId === ledger.ledgerId && sameFiledReturnsScope(legacy.scope, ledger.scope)) {
    await browser.storage.local.remove(deps.storageKeys.fullFiscalYearLedger);
  }
}

export async function clearLedgerPlans(deps: LedgerStorageDeps): Promise<void> {
  const indexKey = deps.storageKeys.fullFiscalYearLedgerIndex;
  if (!indexKey) return;
  const allValues = await browser.storage.local.get(null);
  // Same predicate readPlanLedgersStorageState uses to find these records. A
  // stricter eraser than finder leaves plan records behind on a clear.
  const planKeys = Object.keys(allValues).filter((key) => key.startsWith(PLAN_STORAGE_KEY_PREFIX));
  await browser.storage.local.remove([...planKeys, indexKey]);
}

export async function persistLedgerAndMaybeSummary(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
): Promise<void> {
  await persistLedger(deps, ledger);
  if (ledger.status === "complete") {
    await persistSummary(deps, toFullFiscalYearSummary(ledger, flowStep));
  }
}

export async function persistLedgerAndSummary(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
): Promise<void> {
  await persistLedger(deps, ledger);
  await persistSummary(deps, toFullFiscalYearSummary(ledger, flowStep));
}

export async function persistSummary(
  deps: FiledReturnsFlowRunnerDeps,
  summary: FiledReturnsFlowSummary,
): Promise<void> {
  await persistCanonicalFiledReturnsFlowSummary(deps.storageKeys.completion, summary);
}

export function fullFiscalYearErrorStep(
  target: FiledReturnsFullFiscalYearLedger["targets"][number],
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(target.returnType),
    state: "blocked",
    safeSignals: ["full-fiscal-year-target-error", "pack-error:CONTENT_SCRIPT_UNAVAILABLE"],
    safeMessage: `Pack stopped while checking ${target.period}. The GST tab could not be reached safely.`,
  };
}
async function readPlanLedgerIndex(key: string): Promise<PlanLedgerIndex | null> {
  const values = await browser.storage.local.get(key);
  return parsePlanLedgerIndex(values[key]);
}

function parsePlanLedgerIndex(value: unknown): PlanLedgerIndex | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const index = value as Partial<PlanLedgerIndex>;
  if (index.schemaVersion !== PLAN_INDEX_SCHEMA_VERSION || !index.ledgerIdsByScope) return null;
  if (typeof index.ledgerIdsByScope !== "object" || Array.isArray(index.ledgerIdsByScope)) {
    return null;
  }
  if (
    !Object.entries(index.ledgerIdsByScope).every(
      ([scopeKey, ledgerId]) =>
        scopeKey.length > 0 &&
        scopeKey.length <= 240 &&
        typeof ledgerId === "string" &&
        ledgerId.length > 0 &&
        ledgerId.length <= 120,
    )
  ) {
    return null;
  }
  return {
    schemaVersion: PLAN_INDEX_SCHEMA_VERSION,
    ledgerIdsByScope: { ...index.ledgerIdsByScope },
  };
}

function planScopeKey(scope: FiledReturnsDownloadScope): string {
  return [
    scope.returnType,
    scope.financialYear,
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  ].join(":");
}

function canReplaceLedger(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  if (hasInconsistentFullFiscalYearCompletion(ledger)) return false;
  if (ledger.zipDownloadAttempt || hasRetainedFullFiscalYearStaging(ledger)) return false;
  return (
    ledger.status === "cancelled" ||
    (ledger.status === "complete" && canCompleteFullFiscalYearLedger(ledger))
  );
}

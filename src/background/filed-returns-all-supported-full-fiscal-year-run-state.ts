import { browser } from "wxt/browser";
import { runFiledReturnsOperationCriticalSection } from "./filed-returns-active-run";
import { ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_STORAGE_KEY_PREFIX } from "./storage-keys";
import type { FiledReturnsAllSupportedFullFiscalYearIdentity } from "../connectors/gst/filed-returns-contracts";
import { isCanonicalFullFiscalYearLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import { canCompleteAllSupportedFullFiscalYearLedger } from "./filed-returns-all-supported-full-fiscal-year-ledger";
import {
  isAllSupportedFullFiscalYearLedger,
  isAllSupportedFullFiscalYearPlanRootKey,
  recoverableAllSupportedFullFiscalYearLedgerId,
  type FiledReturnsAllSupportedFullFiscalYearLedger,
} from "./filed-returns-all-supported-full-fiscal-year-validation";

const PLAN_STORAGE_KEY_PREFIX = ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_STORAGE_KEY_PREFIX;
const PLAN_INDEX_SCHEMA_VERSION = "2.0";

type AllSupportedPlanLedgerIndex = {
  schemaVersion: typeof PLAN_INDEX_SCHEMA_VERSION;
  ledgerIdsByPlanRoot: Record<string, string>;
  pendingRemoval?: {
    ledgerId: string;
    planRootKey: string;
  };
};

type LegacyAllSupportedPlanLedgerIndex = {
  schemaVersion: "1.0";
  ledgerIdsByPlanRoot: Record<string, string>;
};

type LedgerStorageDeps = {
  storageKeys: {
    allSupportedFullFiscalYearLedgerIndex?: string;
  };
};

export type AllSupportedPlanLedgersStorageState =
  | { state: "valid"; ledgers: FiledReturnsAllSupportedFullFiscalYearLedger[] }
  | { state: "provenance-unavailable" }
  | { state: "removal-pending" }
  | { state: "malformed" };

export function allSupportedFullFiscalYearPlanStorageKey(ledgerId: string): string {
  return `${PLAN_STORAGE_KEY_PREFIX}${ledgerId}`;
}

export function allSupportedFullFiscalYearPlanRootKey(
  planRoot: FiledReturnsAllSupportedFullFiscalYearIdentity,
): string {
  return `${planRoot.kind}:${planRoot.financialYear}`;
}

export async function readAllSupportedFullFiscalYearLedgerForPlanRoot(
  deps: LedgerStorageDeps,
  planRoot: FiledReturnsAllSupportedFullFiscalYearIdentity,
): Promise<FiledReturnsAllSupportedFullFiscalYearLedger | null> {
  const indexKey = deps.storageKeys.allSupportedFullFiscalYearLedgerIndex;
  if (!indexKey) return null;
  const index = await readAllSupportedPlanLedgerIndex(indexKey);
  const ledgerId = index?.ledgerIdsByPlanRoot[allSupportedFullFiscalYearPlanRootKey(planRoot)];
  if (!ledgerId) return null;
  const ledger = await readAllSupportedFullFiscalYearLedgerById(ledgerId);
  return ledger && samePlanRoot(ledger.planRoot, planRoot) ? ledger : null;
}

export async function readAllSupportedFullFiscalYearLedgerById(
  ledgerId: string,
): Promise<FiledReturnsAllSupportedFullFiscalYearLedger | null> {
  const values = await browser.storage.local.get(
    allSupportedFullFiscalYearPlanStorageKey(ledgerId),
  );
  const ledger = values[allSupportedFullFiscalYearPlanStorageKey(ledgerId)];
  return isAllSupportedFullFiscalYearLedger(ledger) && ledger.ledgerId === ledgerId ? ledger : null;
}

export async function readAllSupportedPlanLedgersStorageState(
  deps: LedgerStorageDeps,
): Promise<AllSupportedPlanLedgersStorageState> {
  return runFiledReturnsOperationCriticalSection(() =>
    readAllSupportedPlanLedgersStorageStateWithinOperation(deps),
  );
}

export async function readAllSupportedPlanLedgersStorageStateWithinOperation(
  deps: LedgerStorageDeps,
): Promise<AllSupportedPlanLedgersStorageState> {
  const indexKey = deps.storageKeys.allSupportedFullFiscalYearLedgerIndex;
  if (!indexKey) return { state: "malformed" };
  const values = await browser.storage.local.get(null);
  const planKeys = Object.keys(values).filter((key) => key.startsWith(PLAN_STORAGE_KEY_PREFIX));
  const indexValue = values[indexKey];
  if (indexValue === undefined || indexValue === null) {
    return planKeys.length === 0 ? { state: "valid", ledgers: [] } : { state: "malformed" };
  }
  const index = parseAllSupportedPlanLedgerIndex(indexValue);
  if (!index) return { state: "malformed" };
  if (index.pendingRemoval) {
    try {
      await finishPendingRemoval(indexKey, index);
    } catch {
      return { state: "removal-pending" };
    }
    return readAllSupportedPlanLedgersStorageStateWithinOperation(deps);
  }
  const ledgerIds = Object.values(index.ledgerIdsByPlanRoot);
  if (new Set(ledgerIds).size !== ledgerIds.length) return { state: "malformed" };
  const expectedPlanKeys = ledgerIds.map(allSupportedFullFiscalYearPlanStorageKey);
  if (expectedPlanKeys.some((key) => !planKeys.includes(key))) {
    return { state: "malformed" };
  }
  if (index.needsMigration) {
    await browser.storage.local.set({ [indexKey]: serialiseAllSupportedPlanLedgerIndex(index) });
    return readAllSupportedPlanLedgersStorageStateWithinOperation(deps);
  }
  if (
    ledgerIds.some((ledgerId) =>
      isPreProvenanceLedger(values[allSupportedFullFiscalYearPlanStorageKey(ledgerId)]),
    )
  ) {
    return { state: "provenance-unavailable" };
  }
  const supersededPlanKeys = planKeys.filter((key) => !expectedPlanKeys.includes(key));
  if (
    !supersededPlanKeys.every((key) => {
      const ledger = values[key];
      return isAllSupportedFullFiscalYearLedger(ledger) && canReplaceLedger(ledger);
    })
  ) {
    return { state: "malformed" };
  }
  const ledgers = Object.entries(index.ledgerIdsByPlanRoot).map(([planRootKey, ledgerId]) => {
    const ledger = values[allSupportedFullFiscalYearPlanStorageKey(ledgerId)];
    return isAllSupportedFullFiscalYearLedger(ledger) &&
      ledger.ledgerId === ledgerId &&
      allSupportedFullFiscalYearPlanRootKey(ledger.planRoot) === planRootKey
      ? ledger
      : null;
  });
  return ledgers.every(
    (ledger): ledger is FiledReturnsAllSupportedFullFiscalYearLedger => ledger !== null,
  )
    ? { state: "valid", ledgers }
    : { state: "malformed" };
}

export async function persistAllSupportedFullFiscalYearLedger(
  deps: LedgerStorageDeps,
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): Promise<void> {
  return runFiledReturnsOperationCriticalSection(() =>
    persistAllSupportedFullFiscalYearLedgerWithinOperation(deps, ledger),
  );
}

async function persistAllSupportedFullFiscalYearLedgerWithinOperation(
  deps: LedgerStorageDeps,
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): Promise<void> {
  const indexKey = requireIndexKey(deps);
  if (!isAllSupportedFullFiscalYearLedger(ledger)) {
    throw new Error("Pack could not verify the all-supported full-year ledger before saving it.");
  }
  if ((await readAllSupportedPlanLedgersStorageStateWithinOperation(deps)).state !== "valid") {
    throw new Error("Pack could not verify the all-supported saved-plan index before saving.");
  }
  const index = (await readAllSupportedPlanLedgerIndex(indexKey)) ?? {
    schemaVersion: PLAN_INDEX_SCHEMA_VERSION,
    ledgerIdsByPlanRoot: {},
  };
  const planRootKey = allSupportedFullFiscalYearPlanRootKey(ledger.planRoot);
  const previousId = index.ledgerIdsByPlanRoot[planRootKey];
  if (previousId && previousId !== ledger.ledgerId) {
    const previous = await readAllSupportedFullFiscalYearLedgerById(previousId);
    if (!previous || !canReplaceLedger(previous)) {
      throw new Error(
        "Pack must resolve the saved all-supported full-year plan before replacing it.",
      );
    }
  }
  index.ledgerIdsByPlanRoot[planRootKey] = ledger.ledgerId;
  await browser.storage.local.set({
    [allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)]: ledger,
    [indexKey]: serialiseAllSupportedPlanLedgerIndex(index),
  });
  if (previousId && previousId !== ledger.ledgerId) {
    await browser.storage.local.remove(allSupportedFullFiscalYearPlanStorageKey(previousId));
  }
}

export async function removeAllSupportedFullFiscalYearLedger(
  deps: LedgerStorageDeps,
  ledger: Pick<FiledReturnsAllSupportedFullFiscalYearLedger, "ledgerId" | "planRoot">,
): Promise<void> {
  return runFiledReturnsOperationCriticalSection(() =>
    removeAllSupportedFullFiscalYearLedgerWithinOperation(deps, ledger),
  );
}

async function removeAllSupportedFullFiscalYearLedgerWithinOperation(
  deps: LedgerStorageDeps,
  ledger: Pick<FiledReturnsAllSupportedFullFiscalYearLedger, "ledgerId" | "planRoot">,
): Promise<void> {
  const indexKey = requireIndexKey(deps);
  const index = await readAllSupportedPlanLedgerIndex(indexKey);
  if (!index) {
    throw new Error("Pack could not verify the all-supported saved-plan index before removing it.");
  }
  const planRootKey = allSupportedFullFiscalYearPlanRootKey(ledger.planRoot);
  if (index.ledgerIdsByPlanRoot[planRootKey] !== ledger.ledgerId) {
    throw new Error("Pack could not match the all-supported saved plan before removing it.");
  }
  delete index.ledgerIdsByPlanRoot[planRootKey];
  index.pendingRemoval = { ledgerId: ledger.ledgerId, planRootKey };
  await browser.storage.local.set({ [indexKey]: serialiseAllSupportedPlanLedgerIndex(index) });
  // The checkpoint makes either post-await state recoverable: the reader only
  // tolerates this exact unindexed ledger and finishes removal on restart.
  await browser.storage.local.remove(allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId));
  delete index.pendingRemoval;
  await browser.storage.local.set({ [indexKey]: serialiseAllSupportedPlanLedgerIndex(index) });
}

export async function clearAllSupportedFullFiscalYearLedgerPlans(
  deps: LedgerStorageDeps,
): Promise<void> {
  const indexKey = deps.storageKeys.allSupportedFullFiscalYearLedgerIndex;
  if (!indexKey) return;
  const index = await readAllSupportedPlanLedgerIndex(indexKey);
  if (index) {
    for (const [planRootKey, ledgerId] of Object.entries(index.ledgerIdsByPlanRoot)) {
      const [kind, financialYear] = planRootKey.split(":");
      if (!kind || !financialYear) {
        throw new Error("Pack could not verify the all-supported saved plan before clearing it.");
      }
      await removeAllSupportedFullFiscalYearLedgerWithinOperation(deps, {
        ledgerId,
        planRoot: { kind: "all-supported-returns-full-fiscal-year", financialYear },
      });
    }
  }
  const values = await browser.storage.local.get(null);
  const planKeys = Object.keys(values).filter((key) => key.startsWith(PLAN_STORAGE_KEY_PREFIX));
  await browser.storage.local.remove([...planKeys, indexKey]);
}

export async function readMalformedAllSupportedFullFiscalYearLedgerState(
  ledgerId: string,
): Promise<{ recoverableLedgerId: string | null } | null> {
  const key = allSupportedFullFiscalYearPlanStorageKey(ledgerId);
  const values = await browser.storage.local.get(key);
  const ledger = values[key];
  if (ledger === undefined || ledger === null || isAllSupportedFullFiscalYearLedger(ledger)) {
    return null;
  }
  return { recoverableLedgerId: recoverableAllSupportedFullFiscalYearLedgerId(ledger) };
}

async function readAllSupportedPlanLedgerIndex(
  key: string,
): Promise<AllSupportedPlanLedgerIndex | null> {
  const values = await browser.storage.local.get(key);
  const index = parseAllSupportedPlanLedgerIndex(values[key]);
  return index ? serialiseAllSupportedPlanLedgerIndex(index) : null;
}

function parseAllSupportedPlanLedgerIndex(
  value: unknown,
): (AllSupportedPlanLedgerIndex & { needsMigration: boolean }) | null {
  if (!isRecord(value)) return null;
  const isV1 = hasOnlyKeys(value, ["schemaVersion", "ledgerIdsByPlanRoot"]);
  const isV2 = hasOnlyKeys(value, ["schemaVersion", "ledgerIdsByPlanRoot", "pendingRemoval"]);
  if (!isV1 && !isV2) return null;
  const index = value as Partial<AllSupportedPlanLedgerIndex | LegacyAllSupportedPlanLedgerIndex>;
  if (
    (index.schemaVersion !== "1.0" && index.schemaVersion !== PLAN_INDEX_SCHEMA_VERSION) ||
    !isRecord(index.ledgerIdsByPlanRoot) ||
    !Object.entries(index.ledgerIdsByPlanRoot).every(
      ([planRootKey, ledgerId]) =>
        isCanonicalPlanRootKey(planRootKey) && isBoundedString(ledgerId, 1, 120),
    )
  ) {
    return null;
  }
  const pendingRemoval = (index as Partial<AllSupportedPlanLedgerIndex>).pendingRemoval;
  if (
    pendingRemoval !== undefined &&
    (!isRecord(pendingRemoval) ||
      !hasOnlyKeys(pendingRemoval, ["ledgerId", "planRootKey"]) ||
      !isCanonicalFullFiscalYearLedgerId(pendingRemoval.ledgerId) ||
      !isAllSupportedPlanRootStorageKey(pendingRemoval.planRootKey) ||
      pendingRemoval.planRootKey in index.ledgerIdsByPlanRoot ||
      Object.values(index.ledgerIdsByPlanRoot).includes(pendingRemoval.ledgerId))
  ) {
    return null;
  }
  return {
    schemaVersion: PLAN_INDEX_SCHEMA_VERSION,
    ledgerIdsByPlanRoot: { ...index.ledgerIdsByPlanRoot },
    ...(pendingRemoval
      ? {
          pendingRemoval: {
            ledgerId: pendingRemoval.ledgerId,
            planRootKey: pendingRemoval.planRootKey,
          },
        }
      : {}),
    needsMigration: index.schemaVersion === "1.0",
  };
}

function serialiseAllSupportedPlanLedgerIndex(
  index: AllSupportedPlanLedgerIndex,
): AllSupportedPlanLedgerIndex {
  return {
    schemaVersion: PLAN_INDEX_SCHEMA_VERSION,
    ledgerIdsByPlanRoot: { ...index.ledgerIdsByPlanRoot },
    ...(index.pendingRemoval ? { pendingRemoval: { ...index.pendingRemoval } } : {}),
  };
}

async function finishPendingRemoval(
  indexKey: string,
  index: AllSupportedPlanLedgerIndex,
): Promise<void> {
  const pendingRemoval = index.pendingRemoval;
  if (!pendingRemoval) return;
  const current = await readAllSupportedPlanLedgerIndex(indexKey);
  if (
    !current?.pendingRemoval ||
    current.pendingRemoval.ledgerId !== pendingRemoval.ledgerId ||
    current.pendingRemoval.planRootKey !== pendingRemoval.planRootKey
  ) {
    throw new Error("Pack could not verify the saved-plan removal checkpoint.");
  }
  await browser.storage.local.remove(
    allSupportedFullFiscalYearPlanStorageKey(pendingRemoval.ledgerId),
  );
  const complete = serialiseAllSupportedPlanLedgerIndex(current);
  delete complete.pendingRemoval;
  await browser.storage.local.set({ [indexKey]: complete });
}

function isPreProvenanceLedger(value: unknown): boolean {
  return isRecord(value) && value.schemaVersion === "1.0";
}

function isAllSupportedPlanRootStorageKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^all-supported-returns-full-fiscal-year:20\d{2}-\d{2}$/.test(value)
  );
}

function canReplaceLedger(ledger: FiledReturnsAllSupportedFullFiscalYearLedger): boolean {
  return (
    ledger.status === "cancelled" ||
    (ledger.status === "complete" && canCompleteAllSupportedFullFiscalYearLedger(ledger))
  );
}

function samePlanRoot(
  left: FiledReturnsAllSupportedFullFiscalYearIdentity,
  right: FiledReturnsAllSupportedFullFiscalYearIdentity,
): boolean {
  return left.kind === right.kind && left.financialYear === right.financialYear;
}

function requireIndexKey(deps: LedgerStorageDeps): string {
  const key = deps.storageKeys.allSupportedFullFiscalYearLedgerIndex;
  if (!key) throw new Error("Pack could not find the all-supported full-year plan storage key.");
  return key;
}

function isCanonicalPlanRootKey(value: string): boolean {
  const [kind, financialYear, ...rest] = value.split(":");
  if (kind === undefined || financialYear === undefined || rest.length !== 0) return false;
  const candidate = { kind, financialYear };
  return (
    isAllSupportedFullFiscalYearPlanRootKey(candidate) &&
    value === allSupportedFullFiscalYearPlanRootKey(candidate)
  );
}

function isBoundedString(input: unknown, min: number, max: number): input is string {
  return typeof input === "string" && input.length >= min && input.length <= max;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasOnlyKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(input).every((key) => allowed.has(key));
}

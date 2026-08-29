import { browser } from "wxt/browser";
import { ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_STORAGE_KEY_PREFIX } from "./storage-keys";
import type { FiledReturnsAllSupportedFullFiscalYearIdentity } from "../connectors/gst/filed-returns-contracts";
import { canCompleteAllSupportedFullFiscalYearLedger } from "./filed-returns-all-supported-full-fiscal-year-ledger";
import {
  isAllSupportedFullFiscalYearLedger,
  isAllSupportedFullFiscalYearPlanRootKey,
  recoverableAllSupportedFullFiscalYearLedgerId,
  type FiledReturnsAllSupportedFullFiscalYearLedger,
} from "./filed-returns-all-supported-full-fiscal-year-validation";

const PLAN_STORAGE_KEY_PREFIX = ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_STORAGE_KEY_PREFIX;
const PLAN_INDEX_SCHEMA_VERSION = "1.0";

type AllSupportedPlanLedgerIndex = {
  schemaVersion: typeof PLAN_INDEX_SCHEMA_VERSION;
  ledgerIdsByPlanRoot: Record<string, string>;
};

type LedgerStorageDeps = {
  storageKeys: {
    allSupportedFullFiscalYearLedgerIndex?: string;
  };
};

export type AllSupportedPlanLedgersStorageState =
  | { state: "valid"; ledgers: FiledReturnsAllSupportedFullFiscalYearLedger[] }
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
  const ledgerIds = Object.values(index.ledgerIdsByPlanRoot);
  if (new Set(ledgerIds).size !== ledgerIds.length) return { state: "malformed" };
  const expectedPlanKeys = ledgerIds.map(allSupportedFullFiscalYearPlanStorageKey);
  if (
    expectedPlanKeys.length !== planKeys.length ||
    expectedPlanKeys.some((key) => !planKeys.includes(key))
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
  const indexKey = requireIndexKey(deps);
  if (!isAllSupportedFullFiscalYearLedger(ledger)) {
    throw new Error("Pack could not verify the all-supported full-year ledger before saving it.");
  }
  if ((await readAllSupportedPlanLedgersStorageState(deps)).state === "malformed") {
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
    [indexKey]: index,
  });
  if (previousId && previousId !== ledger.ledgerId) {
    await browser.storage.local.remove(allSupportedFullFiscalYearPlanStorageKey(previousId));
  }
}

export async function removeAllSupportedFullFiscalYearLedger(
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
  await browser.storage.local.remove(allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId));
  await browser.storage.local.set({ [indexKey]: index });
}

export async function clearAllSupportedFullFiscalYearLedgerPlans(
  deps: LedgerStorageDeps,
): Promise<void> {
  const indexKey = deps.storageKeys.allSupportedFullFiscalYearLedgerIndex;
  if (!indexKey) return;
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
  return parseAllSupportedPlanLedgerIndex(values[key]);
}

function parseAllSupportedPlanLedgerIndex(value: unknown): AllSupportedPlanLedgerIndex | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "ledgerIdsByPlanRoot"]))
    return null;
  const index = value as Partial<AllSupportedPlanLedgerIndex>;
  if (
    index.schemaVersion !== PLAN_INDEX_SCHEMA_VERSION ||
    !isRecord(index.ledgerIdsByPlanRoot) ||
    !Object.entries(index.ledgerIdsByPlanRoot).every(
      ([planRootKey, ledgerId]) =>
        isCanonicalPlanRootKey(planRootKey) && isBoundedString(ledgerId, 1, 120),
    )
  ) {
    return null;
  }
  return {
    schemaVersion: PLAN_INDEX_SCHEMA_VERSION,
    ledgerIdsByPlanRoot: { ...index.ledgerIdsByPlanRoot },
  };
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

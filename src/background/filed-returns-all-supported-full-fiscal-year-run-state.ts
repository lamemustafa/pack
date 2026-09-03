import { browser } from "wxt/browser";
import { runFiledReturnsOperationCriticalSection } from "./filed-returns-active-run";
import { ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_STORAGE_KEY_PREFIX } from "./storage-keys";
import { PACK_CLEAR_LOCAL_DATA_ACTION_LABEL } from "../core/recovery-actions";
import type {
  FiledReturnsAllSupportedFullFiscalYearIdentity,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
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
  /**
   * The plan roots whose ledgers predate provenance. They are carried so a
   * reader can be told *which* saved year it must clear; a blocked state the
   * summary cannot name is one the reader cannot act on.
   */
  | {
      state: "provenance-unavailable";
      planRoots: readonly FiledReturnsAllSupportedFullFiscalYearIdentity[];
    }
  | { state: "removal-pending"; planRoot: FiledReturnsAllSupportedFullFiscalYearIdentity | null }
  | { state: "malformed" };

export function allSupportedFullFiscalYearPlanStorageKey(ledgerId: string): string {
  return `${PLAN_STORAGE_KEY_PREFIX}${ledgerId}`;
}

export function allSupportedFullFiscalYearPlanRootKey(
  planRoot: FiledReturnsAllSupportedFullFiscalYearIdentity,
): string {
  return `${planRoot.kind}:${planRoot.financialYear}`;
}

/**
 * The one inverse of `allSupportedFullFiscalYearPlanRootKey`. Every caller that
 * needs the identity back out of a stored index key goes through this, so the
 * key's shape has a single owner rather than a predicate here and a `split(":")`
 * somewhere else that disagree about what a canonical key is.
 */
export function allSupportedFullFiscalYearPlanRootFromKey(
  planRootKey: string,
): FiledReturnsAllSupportedFullFiscalYearIdentity | null {
  const [kind, financialYear, ...rest] = planRootKey.split(":");
  if (kind === undefined || financialYear === undefined || rest.length !== 0) return null;
  const candidate = { kind, financialYear };
  return isAllSupportedFullFiscalYearPlanRootKey(candidate) &&
    planRootKey === allSupportedFullFiscalYearPlanRootKey(candidate)
    ? candidate
    : null;
}

/**
 * The blocked step a reader is shown when saved-plan state cannot be verified.
 *
 * Owned here because both the start paths and the summary projection have to
 * name the same durable signal for the same storage state; two hand-written
 * copies of that mapping is the drift this repository keeps paying for.
 */
export function savedPlanStorageStateStep(
  financialYear: string,
  state: Exclude<AllSupportedPlanLedgersStorageState["state"], "valid">,
): PortalFlowStepResult {
  const scopeId = `all-supported-full-fiscal-year:${financialYear}`;
  if (state === "provenance-unavailable") {
    return {
      connectorId: "gst",
      scopeId,
      state: "blocked",
      safeSignals: ["all-supported-full-fiscal-year-plan-provenance-unavailable"],
      // Naming a per-plan discard was naming a control that does not exist:
      // this projection deliberately withholds the ledger id every discard,
      // resume and retry control requires, so Options' clear-all is the only
      // shipped escape and the message has to say so.
      safeMessage: `Pack cannot verify the original return and artifact selection for this saved fiscal-year plan. Open Pack's options and use \u201c${PACK_CLEAR_LOCAL_DATA_ACTION_LABEL}\u201d before starting again.`,
    };
  }
  if (state === "removal-pending") {
    return {
      connectorId: "gst",
      scopeId,
      state: "blocked",
      safeSignals: ["all-supported-full-fiscal-year-plan-removal-recovery-pending"],
      safeMessage:
        "Pack is finishing an interrupted saved-plan removal. Refresh this panel before starting another fiscal-year plan.",
    };
  }
  return {
    connectorId: "gst",
    scopeId,
    state: "blocked",
    safeSignals: ["all-supported-full-fiscal-year-plan-index-malformed"],
    safeMessage:
      "Pack could not verify the saved all-supported fiscal-year plan index. Clear the affected local recovery state before starting again.",
  };
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

/**
 * How many times a read may repair the index and look again.
 *
 * Each repair used to tail-call this reader with no budget, so a `set` that did
 * not take -- a failed write, an exhausted quota, a value the parser keeps
 * flagging -- put the service worker in an unbounded read/write/read loop
 * inside the operation critical section, with no terminal state and nothing
 * user-visible. Two passes is one more than any repair needs; exhausting the
 * budget is itself a finding, so it fails closed rather than trying again.
 */
const MAX_STORAGE_STATE_REPAIR_PASSES = 2;

export async function readAllSupportedPlanLedgersStorageStateWithinOperation(
  deps: LedgerStorageDeps,
  repairPass = 0,
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
      return {
        state: "removal-pending",
        planRoot: allSupportedFullFiscalYearPlanRootFromKey(index.pendingRemoval.planRootKey),
      };
    }
    // The repair reported success, so the checkpoint should be gone. If a
    // re-read still finds one, the write did not survive, and the honest state
    // is the one the removal was left in -- not another attempt.
    return repairPass < MAX_STORAGE_STATE_REPAIR_PASSES
      ? readAllSupportedPlanLedgersStorageStateWithinOperation(deps, repairPass + 1)
      : {
          state: "removal-pending",
          planRoot: allSupportedFullFiscalYearPlanRootFromKey(index.pendingRemoval.planRootKey),
        };
  }
  const ledgerIds = Object.values(index.ledgerIdsByPlanRoot);
  if (new Set(ledgerIds).size !== ledgerIds.length) return { state: "malformed" };
  const expectedPlanKeys = ledgerIds.map(allSupportedFullFiscalYearPlanStorageKey);
  if (expectedPlanKeys.some((key) => !planKeys.includes(key))) {
    return { state: "malformed" };
  }
  if (index.needsMigration) {
    try {
      await browser.storage.local.set({ [indexKey]: serialiseAllSupportedPlanLedgerIndex(index) });
    } catch {
      // A migration Pack cannot write is an index Pack cannot vouch for. Naming
      // that keeps the clear path -- the only in-product escape -- reachable,
      // where letting the rejection escape turned every summary and start
      // request into the generic handler error with no route out.
      return { state: "malformed" };
    }
    // An index that still reads as unmigrated after its migration was written
    // is an index Pack cannot vouch for; treat that as malformed rather than
    // rewriting it forever.
    return repairPass < MAX_STORAGE_STATE_REPAIR_PASSES
      ? readAllSupportedPlanLedgersStorageStateWithinOperation(deps, repairPass + 1)
      : { state: "malformed" };
  }
  const preProvenancePlanRootKeys = Object.entries(index.ledgerIdsByPlanRoot)
    .filter(([, ledgerId]) =>
      isPreProvenanceLedger(values[allSupportedFullFiscalYearPlanStorageKey(ledgerId)]),
    )
    .map(([planRootKey]) => planRootKey);
  if (preProvenancePlanRootKeys.length > 0) {
    // The state is decided by the ledgers, never by whether their keys parse:
    // an unparseable key drops a name from the report, it does not make the
    // saved plan verifiable.
    return {
      state: "provenance-unavailable",
      planRoots: preProvenancePlanRootKeys
        .map(allSupportedFullFiscalYearPlanRootFromKey)
        .filter((planRoot): planRoot is FiledReturnsAllSupportedFullFiscalYearIdentity =>
          Boolean(planRoot),
        ),
    };
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
  let index = await readAllSupportedPlanLedgerIndex(indexKey);
  if (!index) {
    throw new Error("Pack could not verify the all-supported saved-plan index before removing it.");
  }
  if (index.pendingRemoval && index.pendingRemoval.ledgerId !== ledger.ledgerId) {
    // Writing this root's checkpoint over another root's strands that root:
    // it is already unindexed, and the checkpoint was the only record that
    // could finish or explain its removal.
    await finishPendingRemoval(indexKey, index);
    index = await readAllSupportedPlanLedgerIndex(indexKey);
    if (!index || index.pendingRemoval) {
      throw new Error(
        "Pack could not finish an earlier saved-plan removal before starting another.",
      );
    }
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
      const planRoot = allSupportedFullFiscalYearPlanRootFromKey(planRootKey);
      // Checkpointed removal is how this stays recoverable when it is
      // interrupted; it is not what makes the clear complete. The catch-all
      // below removes every plan key and the index unconditionally, so a root
      // this loop cannot check-point must not be allowed to stop it -- a clear
      // that gives up half-way leaves exactly the taxpayer state it was asked
      // to delete.
      if (!planRoot) continue;
      try {
        await removeAllSupportedFullFiscalYearLedgerWithinOperation(deps, { ledgerId, planRoot });
      } catch {
        continue;
      }
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
  const planKey = allSupportedFullFiscalYearPlanStorageKey(pendingRemoval.ledgerId);
  const storedPlan = (await browser.storage.local.get(planKey))[planKey];
  // An absent record is the ordinary post-interruption case: the removal got
  // as far as deleting it and the checkpoint is all that is left to clear.
  if (storedPlan !== undefined) {
    // Comparing two copies of the checkpoint only proves the checkpoint agrees
    // with itself. Deleting a record that does not answer to it would drop a
    // ledger while its ledger-keyed staged files stay on disk, and then clear
    // the checkpoint so the index reads healthy and broad cleanup never runs.
    const storedPlanRoot = isRecord(storedPlan) ? storedPlan.planRoot : undefined;
    if (
      !isRecord(storedPlan) ||
      storedPlan.ledgerId !== pendingRemoval.ledgerId ||
      !isAllSupportedFullFiscalYearPlanRootKey(storedPlanRoot) ||
      allSupportedFullFiscalYearPlanRootKey(storedPlanRoot) !== pendingRemoval.planRootKey
    ) {
      throw new Error(
        "Pack could not match the saved plan named by the removal checkpoint, so it was not deleted.",
      );
    }
    await browser.storage.local.remove(planKey);
  }
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
  return allSupportedFullFiscalYearPlanRootFromKey(value) !== null;
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

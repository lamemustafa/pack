import { browser } from "wxt/browser";
import {
  quarantineFiledReturnsStorageState,
  type FiledReturnsStorageQuarantineKey,
} from "./filed-returns-storage-quarantine";

const LEGACY_STATE_KEYS = [
  ["activeRun", "active-run"],
  ["fullFiscalYearLedger", "full-fiscal-year-ledger"],
  ["singlePeriodStaging", "single-period-staging"],
  ["targetReview", "target-review"],
] as const satisfies ReadonlyArray<readonly [string, FiledReturnsStorageQuarantineKey]>;

type LegacyStateKeyName = (typeof LEGACY_STATE_KEYS)[number][0];
type MigrationState = "clean" | "quarantine-pending" | "quarantined";

export interface FiledReturnsV040StateMigrationRecord {
  schemaVersion: "1.0";
  source: "v0.4.x" | "unknown";
  state: MigrationState;
  updatedAt: string;
  quarantinedKeys: FiledReturnsStorageQuarantineKey[];
}

export interface FiledReturnsV040StateMigrationDeps {
  installedVersion: string | null;
  storageKeys: {
    activeRun: string;
    fullFiscalYearLedger: string;
    singlePeriodStaging: string;
    stateMigration: string;
    storageQuarantine: string;
    targetReview: string;
  };
  now?: () => Date;
}

export type FiledReturnsV040StateMigrationOutcome =
  "not-applicable" | "already-migrated" | "clean" | "quarantined";

export async function migrateV040FiledReturnsState(
  deps: FiledReturnsV040StateMigrationDeps,
): Promise<FiledReturnsV040StateMigrationOutcome> {
  const migrationValues = await browser.storage.local.get(deps.storageKeys.stateMigration);
  const existingMigration = parseMigrationRecord(migrationValues[deps.storageKeys.stateMigration]);
  if (existingMigration?.state === "clean" || existingMigration?.state === "quarantined") {
    return "already-migrated";
  }

  const legacyStorageKeys = Object.fromEntries(
    LEGACY_STATE_KEYS.map(([name]) => [name, deps.storageKeys[name as LegacyStateKeyName]]),
  ) as Record<LegacyStateKeyName, string>;
  const values = await browser.storage.local.get(Object.values(legacyStorageKeys));
  const presentKeys = LEGACY_STATE_KEYS.filter(([name]) =>
    hasStoredValue(values[legacyStorageKeys[name]]),
  ).map(([, quarantineKey]) => quarantineKey);

  const resumingQuarantine = existingMigration?.state === "quarantine-pending";
  if (
    !resumingQuarantine &&
    !isV040Version(deps.installedVersion) &&
    !(deps.installedVersion === null && presentKeys.length > 0)
  ) {
    return "not-applicable";
  }

  const now = deps.now?.() ?? new Date();
  const source =
    existingMigration?.source ?? (isV040Version(deps.installedVersion) ? "v0.4.x" : "unknown");
  const quarantinedKeys = existingMigration?.quarantinedKeys ?? presentKeys;
  if (quarantinedKeys.length === 0) {
    await writeMigrationRecord(deps.storageKeys.stateMigration, {
      schemaVersion: "1.0",
      source,
      state: "clean",
      updatedAt: now.toISOString(),
      quarantinedKeys: [],
    });
    return "clean";
  }

  await writeMigrationRecord(deps.storageKeys.stateMigration, {
    schemaVersion: "1.0",
    source,
    state: "quarantine-pending",
    updatedAt: now.toISOString(),
    quarantinedKeys,
  });
  for (const quarantineKey of quarantinedKeys) {
    await quarantineFiledReturnsStorageState(
      deps.storageKeys.storageQuarantine,
      quarantineKey,
      now,
    );
  }
  const keysToRemove = LEGACY_STATE_KEYS.filter(([, key]) => quarantinedKeys.includes(key)).map(
    ([name]) => legacyStorageKeys[name],
  );
  await browser.storage.local.remove(keysToRemove);
  await writeMigrationRecord(deps.storageKeys.stateMigration, {
    schemaVersion: "1.0",
    source,
    state: "quarantined",
    updatedAt: now.toISOString(),
    quarantinedKeys,
  });
  return "quarantined";
}

export async function hasLegacyFiledReturnsStateRequiringReview(
  stateMigrationKey: string,
): Promise<boolean> {
  const values = await browser.storage.local.get(stateMigrationKey);
  return parseMigrationRecord(values[stateMigrationKey])?.state === "quarantined";
}

function parseMigrationRecord(value: unknown): FiledReturnsV040StateMigrationRecord | null {
  if (
    !isRecordWithOnlyKeys(value, [
      "schemaVersion",
      "source",
      "state",
      "updatedAt",
      "quarantinedKeys",
    ])
  ) {
    return null;
  }
  if (
    value.schemaVersion !== "1.0" ||
    (value.source !== "v0.4.x" && value.source !== "unknown") ||
    !isMigrationState(value.state) ||
    !isTimestamp(value.updatedAt) ||
    !Array.isArray(value.quarantinedKeys) ||
    value.quarantinedKeys.length > LEGACY_STATE_KEYS.length ||
    !value.quarantinedKeys.every(isQuarantineKey) ||
    new Set(value.quarantinedKeys).size !== value.quarantinedKeys.length
  ) {
    return null;
  }
  return {
    schemaVersion: "1.0",
    source: value.source,
    state: value.state,
    updatedAt: value.updatedAt,
    quarantinedKeys: [...value.quarantinedKeys],
  };
}

function isMigrationState(value: unknown): value is MigrationState {
  return value === "clean" || value === "quarantine-pending" || value === "quarantined";
}

function isQuarantineKey(value: unknown): value is FiledReturnsStorageQuarantineKey {
  return LEGACY_STATE_KEYS.some(([, key]) => key === value);
}

function isRecordWithOnlyKeys(
  value: unknown,
  allowedKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowedKeys.includes(key))
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function hasStoredValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isV040Version(version: string | null): boolean {
  return version !== null && /^0\.4\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(version);
}

async function writeMigrationRecord(
  storageKey: string,
  record: FiledReturnsV040StateMigrationRecord,
): Promise<void> {
  await browser.storage.local.set({ [storageKey]: record });
}

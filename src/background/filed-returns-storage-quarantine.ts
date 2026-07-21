import { browser } from "wxt/browser";

const MAX_QUARANTINE_ENTRIES = 12;

export type FiledReturnsStorageQuarantineKey =
  | "active-run"
  | "action-journal"
  | "full-fiscal-year-ledger"
  | "single-period-staging"
  | "target-review";

interface FiledReturnsStorageQuarantineEntry {
  key: FiledReturnsStorageQuarantineKey;
  observedAt: string;
  reason: "invalid-state";
  recoveryId: string;
}

interface FiledReturnsStorageQuarantine {
  schemaVersion: "1.0";
  entries: FiledReturnsStorageQuarantineEntry[];
}

export async function quarantineFiledReturnsStorageState(
  storageKey: string | undefined,
  key: FiledReturnsStorageQuarantineKey,
  now = new Date(),
): Promise<void> {
  if (!storageKey) return;

  const values = await browser.storage.local.get(storageKey);
  const current = parseQuarantine(values[storageKey]);
  if (current?.entries.some((entry) => entry.key === key && entry.reason === "invalid-state")) {
    return;
  }

  const entry: FiledReturnsStorageQuarantineEntry = {
    key,
    observedAt: now.toISOString(),
    reason: "invalid-state",
    recoveryId: createRecoveryId(),
  };
  const entries = [...(current?.entries ?? []), entry].slice(-MAX_QUARANTINE_ENTRIES);
  await browser.storage.local.set({
    [storageKey]: { schemaVersion: "1.0", entries } satisfies FiledReturnsStorageQuarantine,
  });
}

function parseQuarantine(value: unknown): FiledReturnsStorageQuarantine | null {
  if (
    !isRecordWithOnlyKeys(value, ["schemaVersion", "entries"]) ||
    value.schemaVersion !== "1.0" ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_QUARANTINE_ENTRIES
  ) {
    return null;
  }
  const entries: FiledReturnsStorageQuarantineEntry[] = [];
  for (const candidate of value.entries) {
    if (
      !isRecordWithOnlyKeys(candidate, ["key", "observedAt", "reason", "recoveryId"]) ||
      !isQuarantineKey(candidate.key) ||
      candidate.reason !== "invalid-state" ||
      !isTimestamp(candidate.observedAt) ||
      !isRecoveryId(candidate.recoveryId)
    ) {
      return null;
    }
    entries.push({
      key: candidate.key,
      observedAt: candidate.observedAt,
      reason: "invalid-state",
      recoveryId: candidate.recoveryId,
    });
  }
  return { schemaVersion: "1.0", entries };
}

function isRecordWithOnlyKeys(
  value: unknown,
  allowed: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}

function isQuarantineKey(value: unknown): value is FiledReturnsStorageQuarantineKey {
  return [
    "active-run",
    "action-journal",
    "full-fiscal-year-ledger",
    "single-period-staging",
    "target-review",
  ].includes(value as FiledReturnsStorageQuarantineKey);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function isRecoveryId(value: unknown): value is string {
  return typeof value === "string" && /^recovery-[a-z0-9-]{8,80}$/.test(value);
}

function createRecoveryId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `recovery-${randomId}`;
  return `recovery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

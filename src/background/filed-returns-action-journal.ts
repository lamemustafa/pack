import { browser } from "wxt/browser";
import type { FiledReturnsConcreteArtifactType } from "../core/filed-returns-artifacts";
import { quarantineFiledReturnsStorageState } from "./filed-returns-storage-quarantine";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";

const MAX_ACTION_JOURNAL_ENTRIES = 12;

export type FiledReturnsActionArtifactType = FiledReturnsConcreteArtifactType | "ZIP";

export type FiledReturnsActionJournalState =
  "armed" | "evidence-bound" | "verified" | "failed" | "review-required" | "discarded";

interface FiledReturnsActionJournalEntry {
  actionId: string;
  artifactType: FiledReturnsActionArtifactType;
  attempt: number;
  revision: number;
  state: FiledReturnsActionJournalState;
  targetId: string;
  armedAt: string;
  downloadId?: number;
  settledAt?: string;
}

export interface FiledReturnsActionJournalRecovery {
  actionId: string;
  expectedRevision: number;
  targetId: string;
}

interface FiledReturnsActionJournal {
  schemaVersion: "1.0";
  entries: FiledReturnsActionJournalEntry[];
}

export async function armFiledReturnsAction(
  key: string | undefined,
  input: Omit<FiledReturnsActionJournalEntry, "attempt" | "revision" | "state" | "armedAt">,
  now = new Date(),
): Promise<"armed" | "blocked"> {
  if (!key) return "armed";
  const journal = await readJournal(key);
  if (!journal) return "blocked";
  if (
    journal.entries.some(
      (entry) =>
        entry.actionId === input.actionId &&
        entry.artifactType === input.artifactType &&
        entry.targetId === input.targetId &&
        entry.state === "armed",
    )
  ) {
    return "armed";
  }
  if (
    hasUnresolvedAction(journal, input.targetId) ||
    journal.entries.some((entry) => entry.actionId === input.actionId)
  ) {
    return "blocked";
  }

  const entry: FiledReturnsActionJournalEntry = {
    ...input,
    attempt: 1,
    revision: 1,
    state: "armed",
    armedAt: now.toISOString(),
  };
  await browser.storage.local.set({
    [key]: { schemaVersion: "1.0", entries: trimTerminalEntries([...journal.entries, entry]) },
  });
  return "armed";
}

export async function bindFiledReturnsActionDownload(
  key: string | undefined,
  actionId: string,
  downloadId: number,
  now = new Date(),
): Promise<boolean> {
  if (!key) return true;
  if (!isPositiveInt(downloadId)) return false;
  const journal = await readJournal(key);
  if (!journal) return false;
  let bound = false;
  const next = journal.entries.map((entry) => {
    if (entry.actionId !== actionId || entry.state !== "armed") return entry;
    bound = true;
    return {
      ...entry,
      downloadId,
      revision: entry.revision + 1,
      state: "evidence-bound" as const,
      settledAt: now.toISOString(),
    };
  });
  if (!bound) return false;
  await browser.storage.local.set({ [key]: { schemaVersion: "1.0", entries: next } });
  return true;
}

export async function settleFiledReturnsAction(
  key: string | undefined,
  actionId: string,
  state: Extract<FiledReturnsActionJournalState, "verified" | "failed" | "review-required">,
  now = new Date(),
): Promise<boolean> {
  if (!key) return true;
  const journal = await readJournal(key);
  if (!journal) return false;
  let updated = false;
  const entries = journal.entries.map((entry) =>
    entry.actionId === actionId &&
    (entry.state === "evidence-bound" ||
      (entry.state === "armed" && (state === "review-required" || state === "failed")))
      ? ((updated = true),
        { ...entry, revision: entry.revision + 1, state, settledAt: now.toISOString() })
      : entry,
  );
  if (!updated) return false;
  await browser.storage.local.set({ [key]: { schemaVersion: "1.0", entries } });
  return true;
}

export async function hasUnresolvedFiledReturnsAction(
  key: string | undefined,
  requestedTargetId?: string,
): Promise<boolean> {
  if (!key) return false;
  const journal = await readJournal(key);
  return journal === null || hasUnresolvedAction(journal, requestedTargetId);
}

export async function clearVerifiedFiledReturnsActions(
  key: string | undefined,
  targetId?: string,
): Promise<void> {
  if (!key) return;
  const journal = await readJournal(key);
  if (!journal) return;
  const entries = journal.entries.filter(
    (entry) =>
      entry.state !== "verified" || (targetId !== undefined && entry.targetId !== targetId),
  );
  await browser.storage.local.set({ [key]: { schemaVersion: "1.0", entries } });
}

export async function readUnresolvedFiledReturnsActionRecovery(
  key: string | undefined,
  requestedTargetId?: string,
): Promise<FiledReturnsActionJournalRecovery | null> {
  if (!key) return null;
  const journal = await readJournal(key);
  if (!journal) return null;
  const unresolved = journal.entries.filter(
    (entry) =>
      (entry.state === "armed" || entry.state === "evidence-bound") &&
      (requestedTargetId === undefined || entry.targetId === requestedTargetId),
  );
  if (unresolved.length !== 1) return null;
  const [entry] = unresolved;
  if (!entry) return null;
  return {
    actionId: entry.actionId,
    expectedRevision: entry.revision,
    targetId: entry.targetId,
  };
}

export async function discardUnresolvedFiledReturnsAction(
  key: string | undefined,
  recovery: FiledReturnsActionJournalRecovery,
): Promise<boolean> {
  if (!key) return false;
  const journal = await readJournal(key);
  if (!journal) return false;
  const entry = journal.entries.find(
    (candidate) =>
      candidate.actionId === recovery.actionId &&
      candidate.targetId === recovery.targetId &&
      candidate.revision === recovery.expectedRevision &&
      (candidate.state === "armed" || candidate.state === "evidence-bound"),
  );
  if (!entry) return false;
  const now = new Date().toISOString();
  const entries = journal.entries.map((candidate) =>
    candidate.actionId === entry.actionId
      ? { ...candidate, revision: candidate.revision + 1, settledAt: now, state: "discarded" as const }
      : candidate,
  );
  await browser.storage.local.set({ [key]: { schemaVersion: "1.0", entries } });
  return true;
}

function hasUnresolvedAction(
  journal: FiledReturnsActionJournal,
  requestedTargetId?: string,
): boolean {
  return journal.entries.some(
    (entry) =>
      (requestedTargetId === undefined || entry.targetId === requestedTargetId) &&
      (entry.state === "armed" || entry.state === "evidence-bound"),
  );
}

async function readJournal(key: string): Promise<FiledReturnsActionJournal | null> {
  const values = await browser.storage.local.get(key);
  const value = values[key];
  if (value === undefined || value === null) return { schemaVersion: "1.0", entries: [] };
  const journal = parseJournal(value);
  if (!journal) {
    await quarantineFiledReturnsStorageState(
      PACK_LOCAL_STORAGE_KEYS.storageQuarantine,
      "action-journal",
    );
  }
  return journal;
}

function parseJournal(value: unknown): FiledReturnsActionJournal | null {
  if (
    !isRecordWithOnlyKeys(value, ["schemaVersion", "entries"]) ||
    value.schemaVersion !== "1.0" ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_ACTION_JOURNAL_ENTRIES
  )
    return null;
  const entries: FiledReturnsActionJournalEntry[] = [];
  const actionIds = new Set<string>();
  for (const candidate of value.entries) {
    if (
      !isRecordWithOnlyKeys(candidate, [
        "actionId",
        "artifactType",
        "attempt",
        "revision",
        "state",
        "targetId",
        "armedAt",
        "downloadId",
        "settledAt",
      ])
    )
      return null;
    if (
      !isBoundedId(candidate.actionId) ||
      actionIds.has(candidate.actionId) ||
      !isBoundedId(candidate.targetId) ||
      !isArtifactType(candidate.artifactType) ||
      !isPositiveInt(candidate.attempt) ||
      !isPositiveInt(candidate.revision) ||
      !isActionState(candidate.state) ||
      !isTimestamp(candidate.armedAt) ||
      (candidate.downloadId !== undefined && !isPositiveInt(candidate.downloadId)) ||
      (candidate.settledAt !== undefined && !isTimestamp(candidate.settledAt))
    )
      return null;
    if (candidate.state === "armed" && candidate.downloadId !== undefined) return null;
    if (
      ["evidence-bound", "verified"].includes(candidate.state) &&
      candidate.downloadId === undefined
    ) {
      return null;
    }
    actionIds.add(candidate.actionId);
    entries.push({
      actionId: candidate.actionId,
      artifactType: candidate.artifactType,
      attempt: candidate.attempt,
      revision: candidate.revision,
      state: candidate.state,
      targetId: candidate.targetId,
      armedAt: candidate.armedAt,
      ...(candidate.downloadId !== undefined ? { downloadId: candidate.downloadId } : {}),
      ...(candidate.settledAt !== undefined ? { settledAt: candidate.settledAt } : {}),
    });
  }
  return { schemaVersion: "1.0", entries };
}

function trimTerminalEntries(
  entries: FiledReturnsActionJournalEntry[],
): FiledReturnsActionJournalEntry[] {
  if (entries.length <= MAX_ACTION_JOURNAL_ENTRIES) return entries;
  const unresolved = entries.filter(
    (entry) => entry.state === "armed" || entry.state === "evidence-bound",
  );
  const terminal = entries.filter(
    (entry) => entry.state !== "armed" && entry.state !== "evidence-bound",
  );
  return unresolved.concat(terminal.slice(-(MAX_ACTION_JOURNAL_ENTRIES - unresolved.length)));
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

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120;
}
function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1_000_000;
}
function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}
function isArtifactType(value: unknown): value is FiledReturnsActionArtifactType {
  return value === "PDF" || value === "EXCEL" || value === "ZIP";
}
function isActionState(value: unknown): value is FiledReturnsActionJournalState {
  return (
    value === "armed" ||
    value === "evidence-bound" ||
    value === "verified" ||
    value === "failed" ||
    value === "review-required" ||
    value === "discarded"
  );
}

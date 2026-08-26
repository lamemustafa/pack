import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { isFiledReturnsArtifactType } from "../connectors/gst/filed-returns-artifacts";
import { isFiledReturnsReturnType } from "../connectors/gst/filed-returns-return-types";
import {
  FILED_RETURNS_MONTHS,
  FULL_FISCAL_YEAR_PERIOD,
  isSupportedFiledReturnsStartScope,
} from "../connectors/gst/filed-returns-scope";
import { isCanonicalFiledReturnsRunId } from "../connectors/gst/filed-returns-operation-id";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";

const ACTIVE_RUN_REVIEW_MS = 30_000;
const ACTIVE_RUN_LEASE_RENEWAL_MS = 10_000;
const ACTIVE_RUN_KEYS = [
  "leaseUpdatedAt",
  "revision",
  "runId",
  "schemaVersion",
  "scope",
  "status",
] as const;
const ACTIVE_RUN_SCOPE_KEYS = [
  "artifactType",
  "completedPeriods",
  "financialYear",
  "period",
  "returnType",
] as const;

export interface ActiveFiledReturnsRun {
  schemaVersion: "1.0";
  runId: string;
  revision: number;
  scope: FiledReturnsDownloadScope;
  status: "running";
  leaseUpdatedAt: string;
}

export interface FiledReturnsActiveRunDeps {
  storageKeys: {
    activeRun?: string;
  };
  now?: () => Date;
}

export type ActiveFiledReturnsRunStorageState =
  | { state: "missing" }
  | { recoverableScope: FiledReturnsDownloadScope | null; state: "malformed" }
  | { run: ActiveFiledReturnsRun; state: "valid" };

let activeRunCriticalSection = Promise.resolve();

export async function acquireFiledReturnsRun(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsActiveRunDeps,
): Promise<{ run: ActiveFiledReturnsRun } | { response: PackMessageResponse }> {
  const key = deps.storageKeys.activeRun;
  if (!key) return { run: createActiveRun(scope, deps.now?.() ?? new Date()) };

  return runFiledReturnsOperationCriticalSection(async () => {
    const now = deps.now?.() ?? new Date();
    const values = await browser.storage.local.get(key);
    const storedRun = activeRunStorageState(values[key], now);
    if (storedRun.state === "malformed") {
      return { response: malformedActiveRunResponse(scope, now) };
    }
    if (storedRun.state === "valid") {
      return { response: activeRunResponse(storedRun.run, now) };
    }

    const run = createActiveRun(scope, now);
    await browser.storage.local.set({ [key]: run });
    return { run };
  });
}

export async function releaseFiledReturnsRun(
  run: ActiveFiledReturnsRun,
  deps: FiledReturnsActiveRunDeps,
): Promise<void> {
  const key = deps.storageKeys.activeRun;
  if (!key) return;

  await runFiledReturnsOperationCriticalSection(async () => {
    const values = await browser.storage.local.get(key);
    const storedRun = activeRunStorageState(values[key], deps.now?.() ?? new Date());
    if (storedRun.state === "valid" && storedRun.run.runId === run.runId) {
      await browser.storage.local.remove(key);
    }
  });
}

export function startFiledReturnsRunLeaseRenewal(
  run: ActiveFiledReturnsRun,
  deps: FiledReturnsActiveRunDeps,
): () => void {
  const intervalId = globalThis.setInterval(() => {
    void renewFiledReturnsRunLease(run, deps).catch(() => undefined);
  }, ACTIVE_RUN_LEASE_RENEWAL_MS);
  return () => globalThis.clearInterval(intervalId);
}

export async function renewFiledReturnsRunLease(
  run: ActiveFiledReturnsRun,
  deps: FiledReturnsActiveRunDeps,
): Promise<void> {
  const key = deps.storageKeys.activeRun;
  if (!key) return;

  await runFiledReturnsOperationCriticalSection(async () => {
    const values = await browser.storage.local.get(key);
    const storedRun = activeRunStorageState(values[key], deps.now?.() ?? new Date());
    if (
      storedRun.state !== "valid" ||
      storedRun.run.runId !== run.runId ||
      storedRun.run.status !== "running"
    ) {
      return;
    }

    await browser.storage.local.set({
      [key]: {
        ...storedRun.run,
        revision: storedRun.run.revision + 1,
        leaseUpdatedAt: (deps.now?.() ?? new Date()).toISOString(),
      } satisfies ActiveFiledReturnsRun,
    });
  });
}

export async function readActiveFiledReturnsRunSummary(
  deps: FiledReturnsActiveRunDeps,
): Promise<FiledReturnsFlowSummary | null> {
  const now = deps.now?.() ?? new Date();
  const state = await readActiveFiledReturnsRunStorageState(deps, now);
  if (state.state === "valid") return activeRunSummary(state.run, now);
  return state.state === "malformed" && state.recoverableScope
    ? malformedActiveRunSummary(state.recoverableScope, now)
    : null;
}

export async function readActiveFiledReturnsRunStorageState(
  deps: FiledReturnsActiveRunDeps,
  now = deps.now?.() ?? new Date(),
): Promise<ActiveFiledReturnsRunStorageState> {
  const key = deps.storageKeys.activeRun;
  if (!key) return { state: "missing" };

  const values = await browser.storage.local.get(key);
  return activeRunStorageState(values[key], now);
}

export async function acknowledgeInterruptedFiledReturnsRun(
  deps: FiledReturnsActiveRunDeps,
): Promise<PackMessageResponse> {
  const key = deps.storageKeys.activeRun;
  if (!key) return acknowledgedRunResponse();

  return runFiledReturnsOperationCriticalSection(async () => {
    const now = deps.now?.() ?? new Date();
    const values = await browser.storage.local.get(key);
    const storedRun = activeRunStorageState(values[key], now);
    if (storedRun.state === "missing") return acknowledgedRunResponse();
    if (storedRun.state === "malformed") {
      return storedRun.recoverableScope
        ? malformedActiveRunResponse(storedRun.recoverableScope, now)
        : {
            ok: false,
            error:
              "Pack found damaged active-run recovery metadata. Use Clear local Pack data before starting another filed-return download.",
          };
    }
    const run = storedRun.run;
    if (!isInterruptedFiledReturnsRun(run, now)) {
      return activeRunResponse(run, now);
    }

    await browser.storage.local.remove(key);
    return acknowledgedRunResponse(run);
  });
}

export async function runFiledReturnsOperationCriticalSection<T>(
  action: () => Promise<T>,
): Promise<T> {
  const previous = activeRunCriticalSection;
  let release: () => void = () => undefined;
  activeRunCriticalSection = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function createActiveRun(scope: FiledReturnsDownloadScope, now: Date): ActiveFiledReturnsRun {
  return {
    schemaVersion: "1.0",
    runId: createRunId(now),
    revision: 1,
    scope,
    status: "running",
    leaseUpdatedAt: now.toISOString(),
  };
}

function activeRunStorageState(input: unknown, now: Date): ActiveFiledReturnsRunStorageState {
  if (input === undefined || input === null) return { state: "missing" };
  const run = parseActiveRun(input, now);
  return run
    ? { run, state: "valid" }
    : { recoverableScope: recoverableActiveRunScope(input, now), state: "malformed" };
}

function parseActiveRun(input: unknown, now: Date): ActiveFiledReturnsRun | null {
  if (!input || typeof input !== "object") return null;
  const run = input as Partial<ActiveFiledReturnsRun> & Record<string, unknown>;
  if (!hasOnlyKeys(run, ACTIVE_RUN_KEYS)) return null;
  if (run.schemaVersion !== "1.0") return null;
  if (!isCanonicalFiledReturnsRunId(run.runId)) return null;
  const revision = run.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) return null;
  if (run.status !== "running" && run.status !== "recovery-blocked") return null;
  if (!isCanonicalTimestamp(run.leaseUpdatedAt)) return null;
  const scope = parseActiveRunScope(run.scope, now);
  if (!scope) return null;
  return {
    leaseUpdatedAt: run.leaseUpdatedAt,
    revision,
    runId: run.runId,
    schemaVersion: "1.0",
    scope,
    // Round-three recovery-blocked records are normalized on read, so an
    // interrupted legacy lease regains the normal acknowledgement exit path.
    status: "running",
  };
}

function recoverableActiveRunScope(input: unknown, now: Date): FiledReturnsDownloadScope | null {
  if (!input || typeof input !== "object") return null;
  return parseActiveRunScope((input as { scope?: unknown }).scope, now);
}

function parseActiveRunScope(input: unknown, now: Date): FiledReturnsDownloadScope | null {
  if (!input || typeof input !== "object") return null;
  const scope = input as Partial<FiledReturnsDownloadScope> & Record<string, unknown>;
  if (!hasOnlyKeys(scope, ACTIVE_RUN_SCOPE_KEYS)) return null;
  if (
    typeof scope.financialYear !== "string" ||
    typeof scope.period !== "string" ||
    !isFiledReturnsReturnType(scope.returnType) ||
    (scope.artifactType !== undefined && !isFiledReturnsArtifactType(scope.artifactType))
  ) {
    return null;
  }
  if (
    scope.completedPeriods !== undefined &&
    (!Array.isArray(scope.completedPeriods) ||
      new Set(scope.completedPeriods).size !== scope.completedPeriods.length ||
      !scope.completedPeriods.every(
        (period) =>
          typeof period === "string" &&
          (FILED_RETURNS_MONTHS as readonly string[]).includes(period),
      ))
  ) {
    return null;
  }
  if (
    scope.period !== FULL_FISCAL_YEAR_PERIOD &&
    !(FILED_RETURNS_MONTHS as readonly string[]).includes(scope.period)
  ) {
    return null;
  }
  const canonicalScope: FiledReturnsDownloadScope = {
    financialYear: scope.financialYear,
    period: scope.period,
    returnType: scope.returnType,
    ...(scope.artifactType ? { artifactType: scope.artifactType } : {}),
    ...(scope.completedPeriods ? { completedPeriods: [...scope.completedPeriods] } : {}),
  };
  return isSupportedFiledReturnsStartScope(canonicalScope, now) ? canonicalScope : null;
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

function isCanonicalTimestamp(input: unknown): input is string {
  if (
    typeof input !== "string" ||
    input.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)
  ) {
    return false;
  }
  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === input;
}

function activeRunResponse(run: ActiveFiledReturnsRun, now: Date): PackMessageResponse {
  const interrupted = isInterruptedFiledReturnsRun(run, now);
  const flowStep = activeRunStep(interrupted, run.scope.returnType);
  return {
    ok: true,
    flowStep,
    flowSummary: activeRunSummary(run, now, flowStep),
  };
}

function activeRunSummary(
  run: ActiveFiledReturnsRun,
  now: Date,
  flowStep = activeRunStep(isInterruptedFiledReturnsRun(run, now), run.scope.returnType),
): FiledReturnsFlowSummary {
  return {
    scope: run.scope,
    status: isInterruptedFiledReturnsRun(run, now) ? "blocked" : "running",
    completedPeriods: [],
    updatedAt: run.leaseUpdatedAt,
    flowStep,
  };
}

function malformedActiveRunResponse(
  scope: FiledReturnsDownloadScope,
  now: Date,
): PackMessageResponse {
  const flowStep = malformedActiveRunStep(scope.returnType);
  return {
    ok: true,
    flowStep,
    flowSummary: malformedActiveRunSummary(scope, now, flowStep),
  };
}

function malformedActiveRunSummary(
  scope: FiledReturnsDownloadScope,
  now: Date,
  flowStep = malformedActiveRunStep(scope.returnType),
): FiledReturnsFlowSummary {
  return {
    scope,
    status: "blocked",
    completedPeriods: [],
    updatedAt: now.toISOString(),
    flowStep,
  };
}

function malformedActiveRunStep(
  returnType: FiledReturnsDownloadScope["returnType"],
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(returnType),
    state: "blocked",
    safeSignals: ["filed-returns-active-run-malformed"],
    safeMessage:
      "Pack found damaged active-run recovery metadata and cannot verify whether another filed-return action already started.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message:
        "Check browser Downloads, then use Clear local Pack data before starting another filed-return download.",
      canResume: false,
    },
  };
}

export function isInterruptedFiledReturnsRun(run: ActiveFiledReturnsRun, now: Date): boolean {
  return now.getTime() - Date.parse(run.leaseUpdatedAt) > ACTIVE_RUN_REVIEW_MS;
}

function acknowledgedRunResponse(run?: ActiveFiledReturnsRun): PackMessageResponse {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(run?.scope.returnType ?? "GSTR-3B"),
    state: "user-action-required",
    safeSignals: ["filed-returns-run-acknowledged"],
    safeMessage:
      "Pack cleared the interrupted run marker. Existing full-year ledger history was preserved.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Start the filed-return download again only after checking browser Downloads.",
      canResume: true,
    },
  };
  return {
    ok: true,
    flowStep,
    ...(run
      ? {
          flowSummary: {
            scope: run.scope,
            status: "blocked" as const,
            completedPeriods: [],
            updatedAt: run.leaseUpdatedAt,
            flowStep,
          },
        }
      : {}),
  };
}

function activeRunStep(
  interrupted: boolean,
  returnType: FiledReturnsDownloadScope["returnType"] = "GSTR-3B",
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(returnType),
    state: "user-action-required",
    safeSignals: [interrupted ? "filed-returns-run-needs-review" : "filed-returns-run-active"],
    safeMessage: interrupted
      ? "Pack found an interrupted filed-returns run. Check Downloads before starting again."
      : "A filed-returns download run is already active in this browser profile.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: interrupted
        ? "Check browser Downloads first. Acknowledge the interrupted run only after confirming the previous run is safe to discard."
        : "Wait for the active filed-returns run to finish before starting another one.",
      canResume: true,
    },
  };
}

function createRunId(now: Date): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `filed-returns-run-${now.getTime().toString(36)}`;
}

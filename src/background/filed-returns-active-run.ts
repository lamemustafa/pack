import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const ACTIVE_RUN_REVIEW_MS = 30_000;
const ACTIVE_RUN_LEASE_RENEWAL_MS = 10_000;

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

let activeRunCriticalSection = Promise.resolve();

export async function acquireFiledReturnsRun(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsActiveRunDeps,
): Promise<{ run: ActiveFiledReturnsRun } | { response: PackMessageResponse }> {
  const key = deps.storageKeys.activeRun;
  if (!key) return { run: createActiveRun(scope, deps.now?.() ?? new Date()) };

  return runActiveRunCriticalSection(async () => {
    const now = deps.now?.() ?? new Date();
    const values = await browser.storage.local.get(key);
    const existingRun = parseActiveRun(values[key]);
    if (existingRun) return { response: activeRunResponse(existingRun, now) };

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

  await runActiveRunCriticalSection(async () => {
    const values = await browser.storage.local.get(key);
    const storedRun = parseActiveRun(values[key]);
    if (storedRun?.runId === run.runId) {
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

  await runActiveRunCriticalSection(async () => {
    const values = await browser.storage.local.get(key);
    const storedRun = parseActiveRun(values[key]);
    if (storedRun?.runId !== run.runId) return;

    await browser.storage.local.set({
      [key]: {
        ...storedRun,
        revision: storedRun.revision + 1,
        leaseUpdatedAt: (deps.now?.() ?? new Date()).toISOString(),
      } satisfies ActiveFiledReturnsRun,
    });
  });
}

export async function readActiveFiledReturnsRunSummary(
  deps: FiledReturnsActiveRunDeps,
): Promise<FiledReturnsFlowSummary | null> {
  const key = deps.storageKeys.activeRun;
  if (!key) return null;

  const values = await browser.storage.local.get(key);
  const run = parseActiveRun(values[key]);
  if (!run) return null;

  return activeRunSummary(run, deps.now?.() ?? new Date());
}

export async function acknowledgeInterruptedFiledReturnsRun(
  deps: FiledReturnsActiveRunDeps,
): Promise<PackMessageResponse> {
  const key = deps.storageKeys.activeRun;
  if (!key) return acknowledgedRunResponse();

  return runActiveRunCriticalSection(async () => {
    const now = deps.now?.() ?? new Date();
    const values = await browser.storage.local.get(key);
    const run = parseActiveRun(values[key]);
    if (!run) return acknowledgedRunResponse();
    if (!isInterruptedRun(run, now)) return activeRunResponse(run, now);

    await browser.storage.local.remove(key);
    return acknowledgedRunResponse(run);
  });
}

async function runActiveRunCriticalSection<T>(action: () => Promise<T>): Promise<T> {
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

function parseActiveRun(input: unknown): ActiveFiledReturnsRun | null {
  if (!input || typeof input !== "object") return null;
  const run = input as Partial<ActiveFiledReturnsRun>;
  if (run.schemaVersion !== "1.0") return null;
  if (typeof run.runId !== "string" || run.runId.length === 0 || run.runId.length > 120) {
    return null;
  }
  const revision = run.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return null;
  if (run.status !== "running") return null;
  if (typeof run.leaseUpdatedAt !== "string" || !Number.isFinite(Date.parse(run.leaseUpdatedAt))) {
    return null;
  }
  if (!run.scope || typeof run.scope !== "object") return null;
  const scope = run.scope as Partial<FiledReturnsDownloadScope>;
  if (
    typeof scope.financialYear !== "string" ||
    typeof scope.period !== "string" ||
    scope.returnType !== "GSTR-3B"
  ) {
    return null;
  }
  return run as ActiveFiledReturnsRun;
}

function activeRunResponse(run: ActiveFiledReturnsRun, now: Date): PackMessageResponse {
  const interrupted = isInterruptedRun(run, now);
  const flowStep = activeRunStep(interrupted);
  return {
    ok: true,
    flowStep,
    flowSummary: activeRunSummary(run, now, flowStep),
  };
}

function activeRunSummary(
  run: ActiveFiledReturnsRun,
  now: Date,
  flowStep = activeRunStep(isInterruptedRun(run, now)),
): FiledReturnsFlowSummary {
  return {
    scope: run.scope,
    status: isInterruptedRun(run, now) ? "blocked" : "running",
    completedPeriods: [],
    updatedAt: run.leaseUpdatedAt,
    flowStep,
  };
}

function isInterruptedRun(run: ActiveFiledReturnsRun, now: Date): boolean {
  return now.getTime() - Date.parse(run.leaseUpdatedAt) > ACTIVE_RUN_REVIEW_MS;
}

function acknowledgedRunResponse(run?: ActiveFiledReturnsRun): PackMessageResponse {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
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

function activeRunStep(interrupted: boolean): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "user-action-required",
    safeSignals: [interrupted ? "filed-returns-run-needs-review" : "filed-returns-run-active"],
    safeMessage: interrupted
      ? "Pack found an interrupted filed-returns run. Check Downloads before starting again."
      : "A filed-returns download run is already active in this browser profile.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: interrupted
        ? "Check Chrome Downloads first. Acknowledge the interrupted run only after confirming the previous run is safe to discard."
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import {
  needsResumeConfirmation,
  summariseFullFiscalYearLedger,
  toFullFiscalYearSummary,
} from "../../src/background/filed-returns-full-fiscal-year-summary";
import {
  persistCanonicalFiledReturnsFlowSummary,
  readCanonicalFiledReturnsFlowSummary,
} from "../../src/background/filed-returns-session-summary";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
  RECOVERY_TARGET_STATUSES,
} from "./full-year-completion-fixtures.test-helpers";

const session = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: session.values[key] })),
        set: vi.fn(async (values: Record<string, unknown>) =>
          Object.assign(session.values, values),
        ),
        remove: vi.fn(async (key: string) => {
          delete session.values[key];
        }),
      },
    },
  },
}));

describe("full-year completion recovery projection", () => {
  beforeEach(() => {
    session.values = {};
  });

  it.each(RECOVERY_TARGET_STATUSES)(
    "keeps %s recovery readable across summary persistence",
    async (status) => {
      const ledger = makeCompletedRecoveryLedger(status);
      const original = structuredClone(ledger);
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      expect(needsResumeConfirmation(ledger)).toBe(status === "pending");

      const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
      expect(summary.status).toBe("blocked");
      expect(summary.completedAt).toBeUndefined();
      expect(summary.updatedAt).toBe(ledger.updatedAt);
      expect(summary.currentPeriod).toBe(ledger.targets[0]!.period);
      expect(summary.fullFiscalYearRecovery).toEqual({
        ledgerId: ledger.ledgerId,
        targetId: ledger.targets[0]!.targetId,
        expectedRevision: ledger.revision,
        targetStatus: status,
      });
      if (status === "running") {
        expect(summary.targetEvidence?.[0]?.outcome).toBe("needs-review");
      }
      if (status === "pending") {
        expect(summary.flowStep.safeSignals).toContain(
          "full-fiscal-year-resume-confirmation-required",
        );
        expect(summary.flowStep.safeMessage).toContain("same GST account");
      }

      const saved = await persistCanonicalFiledReturnsFlowSummary("completion", summary);
      expect(saved).not.toBeNull();
      expect(saved).toMatchObject({
        status: "blocked",
        updatedAt: ledger.updatedAt,
        fullFiscalYearRecovery: summary.fullFiscalYearRecovery,
      });
      expect(saved?.completedAt).toBeUndefined();
      expect(saved?.targetEvidence).toBeUndefined();
      await expect(readCanonicalFiledReturnsFlowSummary("completion")).resolves.toEqual(saved);
      expect(ledger).toEqual(original);
    },
  );

  it.each(RECOVERY_TARGET_STATUSES)("keeps direct %s projections nonterminal", (status) => {
    const ledger = makeCompletedRecoveryLedger(status);
    const summary = toFullFiscalYearSummary(ledger, {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "blocked",
      safeSignals: ["full-fiscal-year-run-needs-action"],
      safeMessage: "The saved run needs an explicit recovery action.",
    });
    expect(summary.status).toBe("blocked");
    expect(summary.completedAt).toBeUndefined();
    expect(summary.fullFiscalYearRecovery?.targetStatus).toBe(status);
  });

  it.each(["blocked", "failed", "cancelled", "manually-observed"] as const)(
    "uses the %s recovery target for both cause and action identity",
    (status) => {
      const ledger = makeCompletedRecoveryLedger(status, {
        positiveFirst: true,
        currentPositive: true,
      });
      const target = ledger.targets[1]!;
      const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
      expect(summary.currentPeriod).toBe(target.period);
      expect(summary.fullFiscalYearRecovery?.targetId).toBe(target.targetId);
      expect(summary.flowStep.safeMessage).toBe(target.safeMessage);
      expect(summary.flowStep.userAction?.message).toContain(target.period);
    },
  );

  it.each(RECOVERY_TARGET_STATUSES)(
    "does not reinterpret %s recovery as legacy cleanup",
    (status) => {
      const ledger = makeCompletedRecoveryLedger(status, { stagedPositive: true });
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
      expect(summary.status).toBe("blocked");
      expect(summary.flowStep.safeSignals).not.toContain("full-fiscal-year-local-cleanup-retry");
      expect(summary.flowStep.safeSignals).not.toContain(
        "full-fiscal-year-zip-phase:legacy-cleanup-pending",
      );
      expect(summary.fullFiscalYearRecovery?.targetStatus).toBe(status);
    },
  );

  it.each(["blocked", "partial", "running", "cancelled"] as const)(
    "does not relabel the existing %s aggregate",
    (status) => {
      const ledger = { ...makeCompletedRecoveryLedger("blocked"), status };
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      expect(summariseFullFiscalYearLedger(ledger, RECOVERY_NOW).status).toBe(status);
    },
  );

  it("keeps an all-positive completion terminal", () => {
    const ledger = makeCompletedRecoveryLedger("not-filed");
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    expect(summary.status).toBe("complete");
    expect(summary.completedAt).toBe(ledger.updatedAt);
    expect(summary.fullFiscalYearRecovery).toBeUndefined();
    expect(summary.completedPeriods).toHaveLength(12);
  });

  it.each(["pending", "running", "blocked"] as const)(
    "keeps unconfirmed-download identity ahead of a current %s target",
    async (status) => {
      const ledger = makeCompletedRecoveryLedger("download-unconfirmed");
      const other = ledger.targets[1]!;
      Object.assign(
        other,
        { status, attempts: status === "pending" ? 0 : 1 },
        canonicalDurableTargetStatus(other, status, []),
      );
      ledger.currentTargetId = other.targetId;
      const original = structuredClone(ledger);
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
      expect(summary.flowStep.safeMessage).toContain("for April");
      expect(summary.currentPeriod).toBe("April");
      expect(summary.fullFiscalYearRecovery).toMatchObject({
        targetId: ledger.targets[0]!.targetId,
        targetStatus: "download-unconfirmed",
        expectedRevision: ledger.revision,
      });
      const saved = await persistCanonicalFiledReturnsFlowSummary("completion", summary);
      expect(saved?.fullFiscalYearRecovery).toEqual(summary.fullFiscalYearRecovery);
      expect(await readCanonicalFiledReturnsFlowSummary("completion")).toEqual(saved);
      expect(ledger).toEqual(original);
    },
  );

  it.each(["pending", "not-filed", "running"] as const)(
    "binds interruption to the running target instead of current %s",
    (status) => {
      const ledger = makeCompletedRecoveryLedger("running");
      ledger.status = "running";
      const other = ledger.targets[1]!;
      Object.assign(
        other,
        { status, attempts: status === "pending" ? 0 : 1 },
        canonicalDurableTargetStatus(
          other,
          status,
          status === "not-filed" ? ["filed-return-positively-not-filed"] : [],
        ),
      );
      ledger.currentTargetId = other.targetId;
      const original = structuredClone(ledger);
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
      expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-run-interrupted");
      expect(summary.flowStep.safeMessage).toContain("for April");
      expect(summary.currentPeriod).toBe("April");
      expect(summary.fullFiscalYearRecovery).toMatchObject({
        targetId: ledger.targets[0]!.targetId,
        targetStatus: "running",
        expectedRevision: ledger.revision,
      });
      expect(ledger).toEqual(original);
    },
  );

  it.each(["blocked", "running"] as const)(
    "preserves current-target preference without interruption in a %s run",
    (status) => {
      const ledger = makeCompletedRecoveryLedger(status);
      ledger.status = status;
      ledger.updatedAt = RECOVERY_NOW.toISOString();
      const current = ledger.targets[1]!;
      Object.assign(
        current,
        { status, attempts: 1 },
        canonicalDurableTargetStatus(current, status, []),
      );
      ledger.currentTargetId = current.targetId;
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
      expect(summary.currentPeriod).toBe("May");
      expect(summary.fullFiscalYearRecovery?.targetId).toBe(current.targetId);
      expect(summary.flowStep.safeSignals).not.toContain("full-fiscal-year-run-interrupted");
      if (status === "blocked") expect(summary.flowStep.safeMessage).toBe(current.safeMessage);
      else expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-run-active");
    },
  );

  it("keeps unconfirmed-download precedence even when another target is interrupted", () => {
    const ledger = makeCompletedRecoveryLedger("download-unconfirmed");
    ledger.status = "running";
    const current = ledger.targets[1]!;
    Object.assign(
      current,
      { status: "running", attempts: 1 },
      canonicalDurableTargetStatus(current, "running", []),
    );
    ledger.currentTargetId = current.targetId;
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-download-unconfirmed");
    expect(summary.flowStep.safeSignals).not.toContain("full-fiscal-year-run-interrupted");
    expect(summary.currentPeriod).toBe("April");
    expect(summary.fullFiscalYearRecovery?.targetStatus).toBe("download-unconfirmed");
  });

  it.each(["blocked", "pending"] as const)(
    "does not let copied interruption diagnostics reselect current %s recovery",
    async (status) => {
      const ledger = makeCompletedRecoveryLedger("running");
      const current = ledger.targets[1]!;
      Object.assign(
        current,
        { status, attempts: 1 },
        canonicalDurableTargetStatus(current, status, ["full-fiscal-year-run-interrupted"]),
      );
      ledger.currentTargetId = current.targetId;
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
      expect(summary.flowStep.safeMessage).toBe(current.safeMessage);
      expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-run-interrupted");
      expect(summary.currentPeriod).toBe("May");
      expect(summary.fullFiscalYearRecovery?.targetId).toBe(current.targetId);
      const saved = await persistCanonicalFiledReturnsFlowSummary("completion", summary);
      expect(saved?.fullFiscalYearRecovery).toEqual(summary.fullFiscalYearRecovery);
      expect(await readCanonicalFiledReturnsFlowSummary("completion")).toEqual(saved);
    },
  );
});

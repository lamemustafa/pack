import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireFiledReturnsRun,
  acknowledgeInterruptedFiledReturnsRun,
  type ActiveFiledReturnsRun,
  readActiveFiledReturnsRunSummary,
  readActiveFiledReturnsRunStorageState,
  renewFiledReturnsRunLease,
} from "../../src/background/filed-returns-active-run";

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));

const ACTIVE_RUN = {
  schemaVersion: "1.0",
  runId: "filed-returns-run-m0abc123",
  revision: 1,
  scope: {
    financialYear: "2026-27",
    period: "April",
    returnType: "GSTR-3B",
  },
  status: "running",
  leaseUpdatedAt: "2026-07-25T00:00:00.000Z",
} satisfies ActiveFiledReturnsRun;

describe("filed returns active run recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.storage.local.get.mockResolvedValue({ "active-run": ACTIVE_RUN });
  });

  it("summarises an orphaned active run as blocked without requiring a start click", async () => {
    const summary = await readActiveFiledReturnsRunSummary({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
    });

    expect(summary).toMatchObject({
      status: "blocked",
      scope: ACTIVE_RUN.scope,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-run-needs-review"],
      },
    });
  });

  it("uses the active run return type when reporting interrupted GSTR-1 state", async () => {
    const gstr1Run: ActiveFiledReturnsRun = {
      ...ACTIVE_RUN,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-1",
      },
    };
    browserMocks.storage.local.get.mockResolvedValue({ "active-run": gstr1Run });

    const summary = await readActiveFiledReturnsRunSummary({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
    });

    expect(summary?.flowStep).toMatchObject({
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      safeSignals: ["filed-returns-run-needs-review"],
    });
  });

  it("preserves an interrupted scope after its current-year cutoff has not yet passed", async () => {
    const currentYearRun: ActiveFiledReturnsRun = {
      ...ACTIVE_RUN,
      scope: { ...ACTIVE_RUN.scope, period: "June" },
    };
    browserMocks.storage.local.get.mockResolvedValue({ "active-run": currentYearRun });

    const state = await readActiveFiledReturnsRunStorageState(
      { storageKeys: { activeRun: "active-run" } },
      new Date("2026-07-15T00:01:00Z"),
    );

    expect(state).toMatchObject({ state: "valid", run: { scope: currentYearRun.scope } });
  });

  it("fails closed for a future financial year in saved active-run metadata", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "active-run": { ...ACTIVE_RUN, scope: { ...ACTIVE_RUN.scope, financialYear: "2099-00" } },
    });

    const state = await readActiveFiledReturnsRunStorageState(
      { storageKeys: { activeRun: "active-run" } },
      new Date("2026-07-15T00:01:00Z"),
    );

    expect(state).toMatchObject({ state: "malformed", recoverableScope: null });
  });

  it("acknowledges an interrupted run by removing only the active run key", async () => {
    const response = await acknowledgeInterruptedFiledReturnsRun({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-run-acknowledged"],
      },
    });
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("active-run");
  });

  it("does not acknowledge a still-active run as interrupted", async () => {
    const response = await acknowledgeInterruptedFiledReturnsRun({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:00:05Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-run-active"],
      },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  // A stale lease proves only that a worker stopped. A plan's recovery may take over the stale lease
  // it OWNS -- the one its own dead run left -- and nothing else.
  //
  // This was first written as "same scope", and adversarial review of #375 showed scope is not
  // identity: every all-supported plan anchors its lease to its first target, GSTR-3B PDF+JSON,
  // which is exactly the scope of a plain single-return GSTR-3B full-year run. A retry of an
  // unrelated GSTR-1 target took over and erased that other run's lease, the only record of its
  // interruption. Ownership is the identity; these pin it.
  describe("taking over a stale lease", () => {
    const OWNER = "all-supported-returns-full-fiscal-year:2026-27";
    const deps = (at: string) => ({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date(at),
    });
    const written = () => {
      const calls = browserMocks.storage.local.set.mock.calls as unknown as Array<
        [Record<string, ActiveFiledReturnsRun>]
      >;
      return calls.at(-1)?.[0]?.["active-run"];
    };

    it("records the owner on a lease it acquires", async () => {
      browserMocks.storage.local.get.mockResolvedValue({});

      await acquireFiledReturnsRun(ACTIVE_RUN.scope, deps("2026-07-25T00:01:00Z"), {
        owner: OWNER,
      });

      expect(written()?.owner).toBe(OWNER);
    });

    it("writes no owner for a flow that does not claim one", async () => {
      browserMocks.storage.local.get.mockResolvedValue({});

      await acquireFiledReturnsRun(ACTIVE_RUN.scope, deps("2026-07-25T00:01:00Z"));

      expect(written()).toBeDefined();
      expect(written()).not.toHaveProperty("owner");
    });

    it("takes over a stale lease it owns", async () => {
      browserMocks.storage.local.get.mockResolvedValue({
        "active-run": { ...ACTIVE_RUN, owner: OWNER },
      });

      const result = await acquireFiledReturnsRun(ACTIVE_RUN.scope, deps("2026-07-25T00:01:00Z"), {
        owner: OWNER,
      });

      expect(result).toHaveProperty("run");
      expect(written()?.runId).not.toBe(ACTIVE_RUN.runId);
      expect(written()?.owner).toBe(OWNER);
    });

    it("refuses a stale lease with no owner, even for the same scope", async () => {
      // The #375 Critical, reduced to its core: the shape of a legacy lease, or of another flow's
      // lease that happens to share this scope. Neither is this caller's to discard.
      const result = await acquireFiledReturnsRun(ACTIVE_RUN.scope, deps("2026-07-25T00:01:00Z"), {
        owner: OWNER,
      });

      expect(result).toMatchObject({
        response: { flowStep: { safeSignals: ["filed-returns-run-needs-review"] } },
      });
      expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    });

    it("refuses a stale lease owned by someone else", async () => {
      browserMocks.storage.local.get.mockResolvedValue({
        "active-run": { ...ACTIVE_RUN, owner: "all-supported-returns-full-fiscal-year:2025-26" },
      });

      const result = await acquireFiledReturnsRun(ACTIVE_RUN.scope, deps("2026-07-25T00:01:00Z"), {
        owner: OWNER,
      });

      expect(result).toHaveProperty("response");
      expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    });

    it("refuses a live lease even when it owns it", async () => {
      browserMocks.storage.local.get.mockResolvedValue({
        "active-run": { ...ACTIVE_RUN, owner: OWNER },
      });

      const result = await acquireFiledReturnsRun(ACTIVE_RUN.scope, deps("2026-07-25T00:00:05Z"), {
        owner: OWNER,
      });

      expect(result).toMatchObject({
        response: { flowStep: { safeSignals: ["filed-returns-run-active"] } },
      });
      expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    });

    it("refuses a stale lease when the caller claims no owner", async () => {
      browserMocks.storage.local.get.mockResolvedValue({
        "active-run": { ...ACTIVE_RUN, owner: OWNER },
      });

      const result = await acquireFiledReturnsRun(ACTIVE_RUN.scope, deps("2026-07-25T00:01:00Z"));

      expect(result).toHaveProperty("response");
      expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    });

    it("treats a lease with a malformed owner as malformed, not as unowned", async () => {
      for (const owner of [42, "", "x".repeat(129), "bad\u0000owner"]) {
        vi.clearAllMocks();
        browserMocks.storage.local.get.mockResolvedValue({
          "active-run": { ...ACTIVE_RUN, owner },
        });

        await expect(
          readActiveFiledReturnsRunStorageState(deps("2026-07-25T00:01:00Z")),
        ).resolves.toMatchObject({ state: "malformed" });
      }
    });

    it("keeps the owner across a renewal", async () => {
      // The parser rebuilds the record field by field and renewal spreads what it parsed, so an
      // owner dropped on read would be written back without it -- silently turning the plan's own
      // lease into an unowned one that its recovery could never take over again.
      browserMocks.storage.local.get.mockResolvedValue({
        "active-run": { ...ACTIVE_RUN, owner: OWNER },
      });

      await renewFiledReturnsRunLease(
        { ...ACTIVE_RUN, owner: OWNER },
        deps("2026-07-25T00:00:20Z"),
      );

      expect(written()?.owner).toBe(OWNER);
    });
  });

  it("normalizes a legacy checkpoint-read lease so its interrupted run can be acknowledged", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "active-run": { ...ACTIVE_RUN, status: "recovery-blocked" },
    });

    const response = await acknowledgeInterruptedFiledReturnsRun({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
    });

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: ["filed-returns-run-acknowledged"],
        userAction: { canResume: true },
      },
    });
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("active-run");
  });

  // A delayed but still-running worker keeps trying to renew its lease. These pin that it cannot
  // bring a cleared lease back, and -- the case that matters for taking over a stale lease -- that
  // it cannot overwrite the lease a newer run took over from it. Review of #374 argued that the old
  // two-click recovery gave such a worker a second staleness check at the later click; that holds
  // only if renewal could restore the lease in between, which the first test here shows it cannot.
  it("does not restore a lease that was cleared while its worker was still renewing", async () => {
    browserMocks.storage.local.get.mockResolvedValue({});

    await renewFiledReturnsRunLease(ACTIVE_RUN, {
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:10Z"),
    });

    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("does not let a delayed worker overwrite a lease another run took over from it", async () => {
    const takenOver = {
      ...ACTIVE_RUN,
      runId: "filed-returns-run-m0zzz999",
      leaseUpdatedAt: "2026-07-25T00:01:00.000Z",
    } satisfies ActiveFiledReturnsRun;
    browserMocks.storage.local.get.mockResolvedValue({ "active-run": takenOver });

    await renewFiledReturnsRunLease(ACTIVE_RUN, {
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:05Z"),
    });

    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("renews the active run lease without changing the scope", async () => {
    await renewFiledReturnsRunLease(ACTIVE_RUN, {
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:00:20Z"),
    });

    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "active-run": {
        ...ACTIVE_RUN,
        revision: 2,
        leaseUpdatedAt: "2026-07-25T00:00:20.000Z",
      },
    });
  });

  it("fails closed instead of overwriting malformed active-run metadata", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "active-run": { ...ACTIVE_RUN, unexpectedPortalMetadata: "synthetic-forbidden" },
    });

    const result = await acquireFiledReturnsRun(ACTIVE_RUN.scope, {
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:00:05Z"),
    });

    expect(result).toMatchObject({
      response: {
        ok: true,
        flowStep: {
          state: "blocked",
          safeSignals: ["filed-returns-active-run-malformed"],
          userAction: { canResume: false },
        },
      },
    });
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  it("reports a recoverable scope for malformed metadata without exposing extra fields", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "active-run": { ...ACTIVE_RUN, runId: "invalid run id" },
    });

    const state = await readActiveFiledReturnsRunStorageState(
      { storageKeys: { activeRun: "active-run" } },
      new Date("2026-07-25T00:00:05Z"),
    );
    const summary = await readActiveFiledReturnsRunSummary({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:00:05Z"),
    });

    expect(state).toEqual({ state: "malformed", recoverableScope: ACTIVE_RUN.scope });
    expect(summary).toMatchObject({
      status: "blocked",
      scope: ACTIVE_RUN.scope,
      flowStep: {
        safeSignals: ["filed-returns-active-run-malformed"],
        userAction: { canResume: false },
      },
    });
  });

  it("does not acknowledge or delete malformed active-run metadata", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "active-run": { ...ACTIVE_RUN, revision: 0 },
    });

    const response = await acknowledgeInterruptedFiledReturnsRun({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: ["filed-returns-active-run-malformed"],
      },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });
});

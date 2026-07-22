import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearVerifiedActionsForPersistedCompleteSummary,
  withPersistedSinglePeriodSummary,
} from "../../src/background/filed-returns-single-period-summary";

const browserMocks = vi.hoisted(() => ({
  storage: {
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
}));

const actionJournalMocks = vi.hoisted(() => ({
  clearVerifiedFiledReturnsActions: vi.fn(async () => undefined),
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));
vi.mock("../../src/background/filed-returns-action-journal", () => actionJournalMocks);

const scope = { financialYear: "2026-27", period: "May", returnType: "GSTR-3B" } as const;
const deps = {
  storageKeys: {
    actionJournal: "action-journal",
    completion: "completion",
  },
} as never;

describe("single-period filed returns summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears a verified action after persisting a provided complete summary", async () => {
    const flowSummary = {
      scope,
      status: "complete" as const,
      completedPeriods: ["May"],
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded" as const,
        safeSignals: ["browser-download-completed"],
        safeMessage: "Downloaded.",
      },
    };

    await withPersistedSinglePeriodSummary(
      scope,
      { ok: true, flowStep: flowSummary.flowStep, flowSummary },
      deps,
      true,
    );

    expect(browserMocks.storage.session.set).toHaveBeenCalledWith({ completion: flowSummary });
    expect(actionJournalMocks.clearVerifiedFiledReturnsActions).toHaveBeenCalledWith(
      "action-journal",
    );
    expect(browserMocks.storage.session.set.mock.invocationCallOrder[0]).toBeLessThan(
      actionJournalMocks.clearVerifiedFiledReturnsActions.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("retains the journal when a provided summary is not complete", async () => {
    const flowSummary = {
      scope,
      status: "blocked" as const,
      completedPeriods: [],
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "download-unconfirmed" as const,
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "Unconfirmed.",
      },
    };

    await withPersistedSinglePeriodSummary(
      scope,
      { ok: true, flowStep: flowSummary.flowStep, flowSummary },
      deps,
      true,
    );

    expect(actionJournalMocks.clearVerifiedFiledReturnsActions).not.toHaveBeenCalled();
  });

  it("does not clear a verified action when completion-summary persistence fails", async () => {
    const flowSummary = {
      scope,
      status: "complete" as const,
      completedPeriods: ["May"],
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded" as const,
        safeSignals: ["browser-download-completed"],
        safeMessage: "Downloaded.",
      },
    };
    browserMocks.storage.session.set.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(
      withPersistedSinglePeriodSummary(
        scope,
        { ok: true, flowStep: flowSummary.flowStep, flowSummary },
        deps,
        true,
      ),
    ).rejects.toThrow("storage unavailable");

    expect(actionJournalMocks.clearVerifiedFiledReturnsActions).not.toHaveBeenCalled();
  });

  it("clears an already-verified action when a prior complete summary is still in session", async () => {
    browserMocks.storage.session.get.mockResolvedValue({
      completion: {
        status: "complete",
        scope,
        flowStep: { state: "downloaded" },
      },
    });

    await clearVerifiedActionsForPersistedCompleteSummary(scope, deps);

    expect(actionJournalMocks.clearVerifiedFiledReturnsActions).toHaveBeenCalledWith(
      "action-journal",
      "GSTR-3B:2026-27:May:PDF",
    );
  });

  it("keeps a verified action protected when the session summary cannot be read", async () => {
    browserMocks.storage.session.get.mockRejectedValueOnce(new Error("storage unavailable"));

    await clearVerifiedActionsForPersistedCompleteSummary(scope, deps);

    expect(actionJournalMocks.clearVerifiedFiledReturnsActions).not.toHaveBeenCalled();
  });

  it("retains verified state when the persisted completion belongs to another target", async () => {
    browserMocks.storage.session.get.mockResolvedValue({
      completion: {
        status: "complete",
        scope: { ...scope, period: "June" },
        flowStep: { state: "downloaded" },
      },
    });

    await clearVerifiedActionsForPersistedCompleteSummary(scope, deps);

    expect(actionJournalMocks.clearVerifiedFiledReturnsActions).not.toHaveBeenCalled();
  });
});

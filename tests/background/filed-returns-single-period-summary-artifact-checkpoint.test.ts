import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAfterPersist: vi.fn(async () => undefined),
  persist: vi.fn(),
  readCompletionEvidence: vi.fn(async () => []),
}));
vi.mock("../../src/background/filed-returns-session-summary", () => ({
  persistCanonicalFiledReturnsFlowSummary: mocks.persist,
}));
vi.mock("../../src/background/artifact-acquisition-state", () => ({
  clearArtifactAcquisitionCheckpointsAfterPersistedSummary: mocks.clearAfterPersist,
  readArtifactAcquisitionCompletionEvidence: mocks.readCompletionEvidence,
}));
import { withPersistedSinglePeriodSummary } from "../../src/background/filed-returns-single-period-summary";

describe("GSTR-3B artifact checkpoint completion ordering", () => {
  it("clears artifact checkpoint ownership only after completion persists", async () => {
    mocks.persist.mockImplementation(async () => {
      expect(mocks.clearAfterPersist).not.toHaveBeenCalled();
      return { completedPeriods: ["April"], flowStep: step(), scope, status: "complete" };
    });
    const response = await withPersistedSinglePeriodSummary(
      scope,
      { ok: true, flowStep: step() },
      {
        storageKeys: {
          completion: "completion",
          fullFiscalYearLedger: "ledger",
          observation: "observation",
        },
      } as never,
      true,
    );
    expect(response).toMatchObject({ flowSummary: { status: "complete" } });
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.clearAfterPersist).toHaveBeenCalledWith(scope, []);
  });
});

const scope = {
  artifactType: "PDF" as const,
  financialYear: "2024-25",
  period: "April",
  returnType: "GSTR-3B" as const,
};
function step() {
  return {
    connectorId: "gst" as const,
    scopeId: "gst-filed-returns-gstr-3b",
    state: "downloaded" as const,
    safeMessage: "Saved.",
    safeSignals: [],
  };
}

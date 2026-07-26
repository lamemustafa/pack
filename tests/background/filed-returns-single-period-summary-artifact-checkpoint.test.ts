import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ persist: vi.fn(), clear: vi.fn() }));
vi.mock("../../src/background/filed-returns-session-summary", () => ({ persistCanonicalFiledReturnsFlowSummary: mocks.persist }));
vi.mock("../../src/background/artifact-acquisition-state", () => ({ clearCompletedArtifactAcquisitionCheckpoint: mocks.clear }));

import { withPersistedSinglePeriodSummary } from "../../src/background/filed-returns-single-period-summary";

describe("GSTR-3B artifact checkpoint completion ordering", () => {
  it("retains the checkpoint until durable completion persistence succeeds", async () => {
    const order: string[] = [];
    mocks.persist.mockImplementation(async () => { order.push("persist"); return { completedPeriods: ["April"], flowStep: step(), scope, status: "complete" }; });
    mocks.clear.mockImplementation(async () => { order.push("clear"); });
    await withPersistedSinglePeriodSummary(scope, { ok: true, flowStep: step() }, { storageKeys: { completion: "completion", fullFiscalYearLedger: "ledger", observation: "observation" } } as never, true);
    expect(order).toEqual(["persist", "clear"]);
  });
});

const scope = { artifactType: "PDF" as const, financialYear: "2024-25", period: "April", returnType: "GSTR-3B" as const };
function step() { return { connectorId: "gst" as const, scopeId: "gst-filed-returns-gstr-3b", state: "downloaded" as const, safeMessage: "Saved.", safeSignals: [] }; }

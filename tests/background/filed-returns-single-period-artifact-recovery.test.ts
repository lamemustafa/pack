import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcileArtifactAcquisitionCheckpoint: vi.fn(),
}));

vi.mock("../../src/background/artifact-acquisition-state", () => ({
  reconcileArtifactAcquisitionCheckpoint: mocks.reconcileArtifactAcquisitionCheckpoint,
}));

import { startSinglePeriodFiledReturnsDownloadFlow } from "../../src/background/filed-returns-single-period-flow";

const scope = {
  artifactType: "PDF" as const,
  financialYear: "2025-26",
  period: "May",
  returnType: "GSTR-3B" as const,
};

describe("GSTR-3B artifact acquisition recovery", () => {
  it("keeps an unresolved checkpoint blocked with its explicit recovery action", async () => {
    mocks.reconcileArtifactAcquisitionCheckpoint.mockResolvedValue({
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-unreconciled"],
    });

    const response = await startSinglePeriodFiledReturnsDownloadFlow(scope, {} as never);

    expect(mocks.reconcileArtifactAcquisitionCheckpoint).toHaveBeenCalledWith(scope);
    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["artifact-acquisition-download-unreconciled"],
        userAction: { type: "RETRY_PORTAL_GENERATION", canResume: true },
      },
    });
  });
});

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearReview: vi.fn(async () => undefined),
  inspectCheckpoint: vi.fn(),
  markCompletion: vi.fn(),
  persistCompletion: vi.fn(),
  readCheckpoints: vi.fn(),
}));

vi.mock("wxt/browser", () => ({ browser: {} }));
vi.mock("../../src/background/artifact-acquisition-state", () => ({
  inspectArtifactAcquisitionCheckpoint: mocks.inspectCheckpoint,
  readArtifactAcquisitionCheckpointTargets: mocks.readCheckpoints,
}));
vi.mock("../../src/background/filed-returns-artifact-acquisition-completion", () => ({
  persistArtifactAcquisitionCompletion: mocks.persistCompletion,
}));
vi.mock("../../src/background/filed-returns-target-review", () => ({
  clearFiledReturnsTargetReview: mocks.clearReview,
  markFiledReturnsTargetReviewArtifactAcquisitionCompletion: mocks.markCompletion,
  readCurrentFiledReturnsTargetReview: vi.fn(),
}));
vi.mock("../../src/background/filed-returns-target-download-attempt", () => ({
  persistFiledReturnsTargetDownloadId: vi.fn(),
}));
vi.mock("../../src/background/filed-returns-target-download-recovery", () => ({
  reconcileFiledReturnsTargetDownload: vi.fn(),
}));
vi.mock("../../src/background/storage-keys", () => ({
  PACK_LOCAL_STORAGE_KEYS: {},
  PACK_SESSION_STORAGE_KEYS: {},
}));

import { reconcileTerminalFiledReturnsDownload } from "../../src/background/filed-returns-durable-download-reconciler";

const april = {
  artifactType: "PDF" as const,
  financialYear: "2025-26",
  period: "April",
  returnType: "GSTR-3B" as const,
};
const may = { ...april, period: "May" };

describe("completed acquisition checkpoint scanner", () => {
  it("persists at most one target proof per scan", async () => {
    mocks.readCheckpoints.mockResolvedValue([{ target: april }, { target: may }]);
    mocks.inspectCheckpoint.mockResolvedValue({
      evidence: { artifactType: "PDF", downloadId: 41, requestId: "request-1" },
      state: "completed",
    });
    mocks.markCompletion.mockResolvedValue({ state: "marked", review: { revision: 2 } });
    mocks.persistCompletion.mockResolvedValue({ status: "complete" });

    await expect(
      reconcileTerminalFiledReturnsDownload({ search: vi.fn(async () => []) }, {
        storageKeys: { completion: "summary" },
      } as never),
    ).resolves.toBe(true);

    expect(mocks.inspectCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.inspectCheckpoint).toHaveBeenCalledWith(april, { preserveMalformed: false });
    expect(mocks.persistCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.persistCompletion).toHaveBeenCalledWith(
      "summary",
      april,
      [{ artifactType: "PDF", downloadId: 41, requestId: "request-1" }],
      expect.any(Date),
    );
    expect(mocks.clearReview).toHaveBeenCalledWith(april, expect.anything(), 2);
  });
});

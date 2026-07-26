import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session: Record<string, unknown> = {};
  return { session, search: vi.fn(), browser: { downloads: { search: vi.fn() }, storage: { session: { get: vi.fn(async (key: string) => ({ [key]: session[key] })), remove: vi.fn(async (key: string) => delete session[key]), set: vi.fn(async (values: Record<string, unknown>) => Object.assign(session, values)) } } } };
});
vi.mock("wxt/browser", () => ({ browser: mocks.browser }));

import { persistArtifactAcquisitionDownloadId, persistArtifactAcquisitionIntent, reconcileArtifactAcquisitionCheckpoint } from "../../src/background/artifact-acquisition-state";

describe("artifact acquisition checkpoint", () => {
  beforeEach(() => { for (const key of Object.keys(mocks.session)) delete mocks.session[key]; vi.clearAllMocks(); });

  it("blocks a restarted intent that never persisted a download ID", async () => {
    await persistArtifactAcquisitionIntent({ artifactType: "PDF", requestId: "request-1" });
    await expect(reconcileArtifactAcquisitionCheckpoint()).resolves.toEqual({ state: "needs-review", safeSignals: ["artifact-acquisition-intent-interrupted"] });
  });

  it("blocks a completed exact ID until the prior acquisition is reconciled", async () => {
    await persistArtifactAcquisitionDownloadId({ artifactType: "JSON", downloadId: 9, requestId: "request-2", state: "download-observing" });
    mocks.browser.downloads.search.mockResolvedValue([{ id: 9, state: "complete", bytesReceived: 4 }]);
    await expect(reconcileArtifactAcquisitionCheckpoint()).resolves.toEqual({ state: "needs-review", safeSignals: ["artifact-acquisition-download-complete-unreconciled"] });
  });
});

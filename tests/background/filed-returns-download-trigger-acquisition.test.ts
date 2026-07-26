import { describe, expect, it, vi } from "vitest";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";

const captureMocks = vi.hoisted(() => ({
  startMainWorldCapturedFiledReturnDownload: vi.fn(),
}));

vi.mock("../../src/background/filed-returns-captured-download", () => captureMocks);

import { Gstr3bArtifactAcquisitionBlockReason } from "../../src/background/gstr3b-artifact-acquisition-block";
import { triggerAndObserveFiledReturnDownload } from "../../src/background/filed-returns-download-trigger";
import { startFullFiscalYearDownloadFlow } from "../../src/background/filed-returns-full-fiscal-year";

describe("GSTR-3B artifact acquisition dispatch", () => {
  it("blocks the full-year runner before it can expand GSTR-3B into legacy monthly targets", async () => {
    const runSinglePeriod = vi.fn();

    const response = await startFullFiscalYearDownloadFlow(
      { financialYear: "2025-26", period: "FULL_FISCAL_YEAR", returnType: "GSTR-3B" },
      {} as never,
      runSinglePeriod,
    );

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: [Gstr3bArtifactAcquisitionBlockReason.FullFiscalYearNotWired],
      },
    });
    expect(runSinglePeriod).not.toHaveBeenCalled();
  });

  it.each([
    ["April", "PDF"],
    ["March", "JSON"],
    ["ALL", "PDF"],
    ["ALL", "JSON"],
  ] as const)("never sends GSTR-3B %s %s through legacy capture", async (period, artifactType) => {
    const sendMessageToTabWithInjection = vi.fn(
      async () =>
        ({
          ok: true,
          artifact: {
            ok: false,
            reason: "generation-timeout",
            requestId: "synthetic-request",
            safeSignals: [],
          },
        }) as PackMessageResponse,
    );

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: period === "ALL" ? null : period,
      artifactType,
      deps: { sendMessageToTabWithInjection, storageKeys: {} },
      scope: { financialYear: "2025-26", period, returnType: "GSTR-3B" },
      tabId: 17,
    });

    expect(captureMocks.startMainWorldCapturedFiledReturnDownload).not.toHaveBeenCalled();
    if (period === "ALL") {
      expect(response).toMatchObject({
        flowStep: {
          state: "blocked",
          safeSignals: [Gstr3bArtifactAcquisitionBlockReason.FullFiscalYearNotWired],
        },
      });
      expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
      return;
    }
    expect(sendMessageToTabWithInjection).toHaveBeenCalledWith(
      17,
      expect.objectContaining({ type: "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34" }),
    );
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalledWith(
      17,
      expect.objectContaining({ type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" }),
    );
  });
});

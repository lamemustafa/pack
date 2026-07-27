import { describe, expect, it, vi } from "vitest";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";

const captureMocks = vi.hoisted(() => ({
  acquireGstr3bPdfAfterPreflight: vi.fn(async () => ({
    ok: true as const,
    safeSignals: ["synthetic-extension-download-complete"],
  })),
  downloadAcquiredArtifact: vi.fn(async () => ({
    ok: true as const,
    downloadId: 91,
    bytesReceived: 128,
    safeSignals: ["synthetic-extension-download-complete"],
  })),
  persistArtifactAcquisitionDownloadId: vi.fn(async () => undefined),
  persistArtifactAcquisitionIntent: vi.fn(async () => undefined),
  startMainWorldCapturedFiledReturnDownload: vi.fn(),
}));

vi.mock("../../src/background/filed-returns-captured-download", () => captureMocks);
vi.mock("../../src/background/artifact-download", () => ({
  downloadAcquiredArtifact: captureMocks.downloadAcquiredArtifact,
}));
vi.mock("../../src/background/artifact-acquisition-state", () => ({
  persistArtifactAcquisitionDownloadId: captureMocks.persistArtifactAcquisitionDownloadId,
  persistArtifactAcquisitionIntent: captureMocks.persistArtifactAcquisitionIntent,
}));
vi.mock("../../src/background/gstr3b-artifact-acquisition", () => ({
  acquireGstr3bPdfAfterPreflight: captureMocks.acquireGstr3bPdfAfterPreflight,
}));

import { Gstr3bArtifactAcquisitionBlockReason } from "../../src/background/gstr3b-artifact-acquisition-block";
import {
  ARTIFACT_FAILURE_MESSAGES,
  type ArtifactFailureReason,
} from "../../src/connectors/gst/artifact-source";
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

  it.each(Object.keys(ARTIFACT_FAILURE_MESSAGES) as ArtifactFailureReason[])(
    "surfaces the %s acquisition failure as a distinct blocked popup message",
    async (reason) => {
      const response = await triggerAndObserveFiledReturnDownload({
        activePeriod: "April",
        artifactType: "PDF",
        deps: {
          sendMessageToTabWithInjection: vi.fn(
            async () =>
              ({
                ok: true,
                artifact: {
                  ok: false,
                  reason,
                  requestId: "synthetic-request",
                  safeSignals: ["synthetic-artifact-failure"],
                },
              }) as PackMessageResponse,
          ),
          storageKeys: {},
        },
        scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-3B" },
        tabId: 17,
      });

      expect(response).toMatchObject({
        flowStep: {
          state: "blocked",
          safeMessage: ARTIFACT_FAILURE_MESSAGES[reason],
          safeSignals: expect.arrayContaining([
            "artifact-acquisition-failed",
            `artifact-${reason}`,
            "synthetic-artifact-failure",
          ]),
        },
      });
    },
  );

  it("writes acquired JSON into the FY, return-type, and period folder", async () => {
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "June",
      artifactType: "JSON",
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async () =>
            ({
              ok: true,
              artifact: {
                ok: true,
                state: "acquired",
                requestId: "synthetic-request",
                base64: "eyJzdGF0dXMiOjF9",
                mimeType: "application/json",
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-3B" },
      tabId: 17,
    });

    expect(response).toMatchObject({ flowStep: { state: "downloaded" } });
    expect(captureMocks.downloadAcquiredArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "ComplyEaze-Pack/2026-27/GSTR-3B/June-data.json",
      }),
    );
  });

  it("writes a prepared PDF into the FY, return-type, and period folder", async () => {
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "June",
      artifactType: "PDF",
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async () =>
            ({
              ok: true,
              artifact: {
                ok: true,
                state: "ready",
                requestId: "synthetic-request",
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-3B" },
      tabId: 17,
    });

    expect(response).toMatchObject({ flowStep: { state: "downloaded" } });
    expect(captureMocks.acquireGstr3bPdfAfterPreflight).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "ComplyEaze-Pack/2026-27/GSTR-3B/June.pdf" }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";

const captureMocks = vi.hoisted(() => ({
  acquireGstr3bPdfAfterPreflight: vi.fn(async () => ({
    ok: true as const,
    safeSignals: ["synthetic-extension-download-complete"],
  })),
  acquireGstr2bPageGeneratedArtifact: vi.fn(async () => ({
    ok: true as const,
    safeSignals: ["synthetic-extension-download-complete"],
  })),
  downloadAcquiredArtifact: vi.fn(async () => ({
    ok: true as const,
    downloadId: 91,
    bytesReceived: 128,
    safeMessage: undefined as string | undefined,
    safeSignals: ["synthetic-extension-download-complete"],
  })),
  clearArtifactAcquisitionCheckpoint: vi.fn(async () => undefined),
  persistArtifactAcquisitionDownloadId: vi.fn(async () => undefined),
  persistArtifactAcquisitionIntent: vi.fn(async () => undefined),
  persistArtifactAcquisitionUnconfirmedDownload: vi.fn(async () => undefined),
  startMainWorldCapturedFiledReturnDownload: vi.fn(),
}));

vi.mock("../../src/background/filed-returns-captured-download", () => captureMocks);
vi.mock("../../src/background/artifact-download", () => ({
  downloadAcquiredArtifact: captureMocks.downloadAcquiredArtifact,
}));
vi.mock("../../src/background/artifact-acquisition-state", () => ({
  clearArtifactAcquisitionCheckpoint: captureMocks.clearArtifactAcquisitionCheckpoint,
  persistArtifactAcquisitionDownloadId: captureMocks.persistArtifactAcquisitionDownloadId,
  persistArtifactAcquisitionIntent: captureMocks.persistArtifactAcquisitionIntent,
  persistArtifactAcquisitionUnconfirmedDownload:
    captureMocks.persistArtifactAcquisitionUnconfirmedDownload,
}));
vi.mock("../../src/background/gstr3b-artifact-acquisition", () => ({
  acquireGstr3bPdfAfterPreflight: captureMocks.acquireGstr3bPdfAfterPreflight,
}));
vi.mock("../../src/background/gstr2b-artifact-acquisition", () => ({
  acquireGstr2bPageGeneratedArtifact: captureMocks.acquireGstr2bPageGeneratedArtifact,
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

  it("surfaces a completed JSON filename override without treating the target as failed", async () => {
    captureMocks.downloadAcquiredArtifact.mockResolvedValueOnce({
      ok: true,
      downloadId: 91,
      bytesReceived: 128,
      safeMessage:
        "Another extension changed where this file was saved; Pack asked for ComplyEaze-Pack/2026-27/GSTR-3B/June-data.json; the browser saved it elsewhere as download.json.",
      safeSignals: ["download-filename-overridden"],
    });

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "June",
      artifactType: "JSON",
      deps: {
        sendMessageToTabWithInjection: vi.fn(async () => acquiredJson()),
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-3B" },
      tabId: 17,
    });

    expect(response).toMatchObject({
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining(["download-filename-overridden"]),
        safeMessage:
          "Another extension changed where this file was saved; Pack asked for ComplyEaze-Pack/2026-27/GSTR-3B/June-data.json; the browser saved it elsewhere as download.json.",
      },
    });
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

describe("GSTR-2B artifact acquisition dispatch", () => {
  it.each([
    ["PDF", "ComplyEaze-Pack/2026-27/GSTR-2B/June.pdf"],
    ["EXCEL", "ComplyEaze-Pack/2026-27/GSTR-2B/June.xlsx"],
  ] as const)("never reaches main-world capture for %s", async (artifactType, filename) => {
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "June",
      artifactType,
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async () =>
            ({
              ok: true,
              artifact: {
                ok: true,
                requestId: "synthetic-2b-request",
                safeSignals: ["target-period-verified"],
                state: "ready",
              },
            }) as PackMessageResponse,
        ),
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-2B" },
      tabId: 17,
    });
    expect(response).toMatchObject({ flowStep: { state: "downloaded" } });
    expect(captureMocks.startMainWorldCapturedFiledReturnDownload).not.toHaveBeenCalled();
    expect(captureMocks.acquireGstr2bPageGeneratedArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ artifactType, filename, tabId: 17 }),
    );
  });

  it("blocks a GSTR-2B full-year request instead of falling through to legacy capture", async () => {
    const sendMessageToTabWithInjection = vi.fn();
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: null,
      artifactType: "PDF",
      deps: { sendMessageToTabWithInjection, storageKeys: {} },
      scope: { financialYear: "2026-27", period: "ALL", returnType: "GSTR-2B" },
      tabId: 17,
    });
    expect(response).toMatchObject({
      flowStep: {
        safeSignals: ["gstr2b-full-fiscal-year-acquisition-not-wired"],
        state: "blocked",
      },
    });
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
    expect(captureMocks.startMainWorldCapturedFiledReturnDownload).not.toHaveBeenCalled();
  });
});

function acquiredJson(): PackMessageResponse {
  return {
    ok: true,
    artifact: {
      ok: true,
      state: "acquired",
      requestId: "synthetic-request",
      base64: "eyJzdGF0dXMiOjF9",
      mimeType: "application/json",
      safeSignals: [],
    },
  };
}

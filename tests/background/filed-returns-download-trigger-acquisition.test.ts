import { describe, expect, it, vi } from "vitest";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";

const captureMocks = vi.hoisted(() => ({
  acquireGstr3bPdfAfterPreflight: vi.fn(async () => ({
    ok: true as const,
    safeSignals: ["synthetic-extension-download-complete"],
  })),
  acquirePageGeneratedArtifact: vi.fn(async () => ({
    ok: true as const,
    bytes: new Uint8Array([0x50, 0x4b]),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
}));
const summaryStorage = vi.hoisted(() => ({
  remove: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
}));

vi.mock("wxt/browser", () => ({
  browser: { storage: { session: summaryStorage } },
}));

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
  acquirePageGeneratedArtifact: captureMocks.acquirePageGeneratedArtifact,
}));

import { Gstr3bArtifactAcquisitionBlockReason } from "../../src/background/gstr3b-artifact-acquisition-block";
import {
  ARTIFACT_FAILURE_MESSAGES,
  type ArtifactFailureReason,
} from "../../src/connectors/gst/artifact-source";
import {
  GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES,
  GSTR1_ARTIFACT_DISPATCH_FAILURE_MESSAGES,
  Gstr1ArtifactDispatchFailureReason,
  Gstr2bArtifactDispatchFailureReason,
  triggerAndObserveFiledReturnDownload,
} from "../../src/background/filed-returns-download-trigger";
import { startFullFiscalYearDownloadFlow } from "../../src/background/filed-returns-full-fiscal-year";
import { withPersistedSinglePeriodSummary } from "../../src/background/filed-returns-single-period-summary";
import { FILED_RETURNS_RETURN_TYPES } from "../../src/connectors/gst/filed-returns-return-types";

const ARTIFACT_ACQUISITION_RETURN_TYPES = FILED_RETURNS_RETURN_TYPES;

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

  it.each(
    ARTIFACT_ACQUISITION_RETURN_TYPES.flatMap((returnType) =>
      (Object.keys(ARTIFACT_FAILURE_MESSAGES) as ArtifactFailureReason[]).map(
        (reason) => [returnType, reason] as const,
      ),
    ),
  )(
    "surfaces the %s %s acquisition failure as a distinct blocked popup message",
    async (returnType, reason) => {
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
        scope: { financialYear: "2025-26", period: "April", returnType },
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

  it.each(FILED_RETURNS_RETURN_TYPES)(
    "renders a non-empty terminal message for a blocked %s flow",
    async (returnType) => {
      const response = await triggerAndObserveFiledReturnDownload({
        activePeriod: "April",
        artifactType: "PDF",
        deps: {
          sendMessageToTabWithInjection: vi.fn(async (_tabId, message) => {
            if (message.type === "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34") {
              return {
                ok: true,
                artifact: {
                  ok: false,
                  reason: "generation-timeout",
                  requestId: "synthetic-request",
                  safeSignals: [],
                },
              } satisfies PackMessageResponse;
            }
            return {
              ok: true,
              downloadTrigger: {
                connectorId: "gst",
                scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
                state: "blocked",
                safeSignals: ["filed-gstr1-download-trigger-ambiguous"],
                safeMessage: "The synthetic GSTR-1 portal control was ambiguous.",
              },
            } satisfies PackMessageResponse;
          }),
          storageKeys: {},
        },
        scope: { financialYear: "2025-26", period: "April", returnType },
        tabId: 17,
      });

      expect(response).toMatchObject({
        ok: true,
        flowStep: { state: "blocked", safeMessage: expect.any(String) },
      });
      if (!response.ok || !("flowStep" in response))
        throw new Error("Expected terminal flow step.");
      expect(response.flowStep.safeMessage.trim()).not.toBe("");
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
      expect.objectContaining({ filename: "ComplyEaze-Pack/2026-27/GSTR-3B/June-return.pdf" }),
    );
  });

  it("turns a successful V34 reply without an artifact into a terminal GSTR-3B failure", async () => {
    await expect(
      triggerAndObserveFiledReturnDownload({
        activePeriod: "April",
        artifactType: "PDF",
        deps: {
          sendMessageToTabWithInjection: vi.fn(async () => ({ ok: true }) as PackMessageResponse),
          storageKeys: {},
        },
        scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-3B" },
        tabId: 17,
      }),
    ).resolves.toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: expect.arrayContaining([
          "artifact-acquisition-failed",
          "artifact-response-missing",
        ]),
      },
    });
  });
});

describe("GSTR-2B artifact acquisition dispatch", () => {
  it("turns an April summary-page response without an artifact into a terminal message", async () => {
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "PDF",
      deps: {
        sendMessageToTabWithInjection: vi.fn(async () => ({ ok: true }) as PackMessageResponse),
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "April", returnType: "GSTR-2B" },
      tabId: 17,
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeMessage: expect.any(String),
        safeSignals: expect.arrayContaining(["gstr2b-artifact-response-missing"]),
      },
    });
  });

  it.each([
    [Gstr2bArtifactDispatchFailureReason.PeriodInvalid, "Unknown", "PDF", undefined],
    [
      Gstr2bArtifactDispatchFailureReason.ContentUnavailable,
      "April",
      "PDF",
      { ok: false, error: "CONTENT_SCRIPT_UNAVAILABLE" },
    ],
    [Gstr2bArtifactDispatchFailureReason.ResponseMissing, "April", "PDF", { ok: true }],
    [
      Gstr2bArtifactDispatchFailureReason.StateInvalid,
      "April",
      "JSON",
      {
        ok: true,
        artifact: {
          ok: true,
          requestId: "synthetic-2b-request",
          safeSignals: [],
          state: "ready",
        },
      },
    ],
  ] as const)(
    "maps %s to a durable terminal message",
    async (reason, period, artifactType, reply) => {
      const sendMessageToTabWithInjection = vi.fn(async () => reply as PackMessageResponse);
      const response = await triggerAndObserveFiledReturnDownload({
        activePeriod: period,
        artifactType,
        deps: { sendMessageToTabWithInjection, storageKeys: {} },
        scope: { financialYear: "2026-27", period, returnType: "GSTR-2B" },
        tabId: 17,
      });

      expect(response).toMatchObject({
        ok: true,
        flowStep: {
          state: "blocked",
          safeSignals: [reason],
          safeMessage: GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES[reason],
        },
      });
    },
  );

  it.each(["PDF", "EXCEL"] as const)(
    "captures validated %s bytes before delivery",
    async (artifactType) => {
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
      expect(captureMocks.acquirePageGeneratedArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ artifactType, tabId: 17 }),
      );
    },
  );

  it("writes GSTR-2B portal data with its data suffix", async () => {
    await triggerAndObserveFiledReturnDownload({
      activePeriod: "June",
      artifactType: "JSON",
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async (_tabId, message) =>
            ({
              ok: true,
              artifact: {
                ok: true,
                state: "acquired",
                requestId: message.payload.requestId,
                base64: "e30=",
                mimeType: "application/json",
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-2B" },
      tabId: 17,
    });

    expect(captureMocks.downloadAcquiredArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "ComplyEaze-Pack/2026-27/GSTR-2B/June-data.json" }),
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
  });
});

describe("GSTR-1 artifact acquisition dispatch", () => {
  it.each(["PDF", "EXCEL"] as const)(
    "uses the bounded portal shim for the %s artifact",
    async (artifactType) => {
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
                  requestId: "synthetic-gstr1-request",
                  safeSignals: ["target-period-verified"],
                  state: "ready",
                },
              }) as PackMessageResponse,
          ),
          storageKeys: {},
        },
        scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-1" },
        tabId: 17,
      });

      expect(response).toMatchObject({ flowStep: { state: "downloaded" } });
      expect(captureMocks.acquirePageGeneratedArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ artifactType, returnType: "GSTR-1", tabId: 17 }),
      );
    },
  );

  it.each([
    [Gstr1ArtifactDispatchFailureReason.PeriodInvalid, "FULL_FISCAL_YEAR", "PDF", undefined],
    [
      Gstr1ArtifactDispatchFailureReason.ContentUnavailable,
      "April",
      "PDF",
      { ok: false, error: "CONTENT_SCRIPT_UNAVAILABLE" },
    ],
    [Gstr1ArtifactDispatchFailureReason.ResponseMissing, "April", "PDF", { ok: true }],
    [
      Gstr1ArtifactDispatchFailureReason.StateInvalid,
      "April",
      "PDF",
      {
        ok: true,
        artifact: {
          ok: true,
          requestId: "synthetic-gstr1-request",
          safeSignals: [],
          state: "acquired",
          base64: "e30=",
          mimeType: "application/json",
        },
      },
    ],
  ] as const)(
    "maps %s to a rendered terminal message",
    async (reason, period, artifactType, reply) => {
      vi.clearAllMocks();
      const scope = {
        artifactType,
        financialYear: "2026-27",
        period,
        returnType: "GSTR-1",
      } as const;
      const response = await triggerAndObserveFiledReturnDownload({
        activePeriod: period,
        artifactType,
        deps: {
          sendMessageToTabWithInjection: vi.fn(async () => reply as PackMessageResponse),
          storageKeys: {},
        },
        scope,
        tabId: 17,
      });

      expect(response).toMatchObject({
        ok: true,
        flowStep: {
          safeMessage: GSTR1_ARTIFACT_DISPATCH_FAILURE_MESSAGES[reason],
          safeSignals: [reason],
          state: "blocked",
        },
      });
      if (!response.ok || !("flowStep" in response))
        throw new Error("Expected a terminal flow step.");
      const durableScope = period === "FULL_FISCAL_YEAR" ? { ...scope, period: "April" } : scope;
      const persisted = await withPersistedSinglePeriodSummary(
        durableScope,
        response,
        { storageKeys: { completion: "completion" } } as never,
        true,
      );
      expect(persisted).toMatchObject({
        flowSummary: {
          flowStep: { safeSignals: [reason], state: "blocked" },
          status: "blocked",
        },
      });
      expect(summaryStorage.set).toHaveBeenCalledWith({
        completion: expect.objectContaining({
          flowStep: expect.objectContaining({ safeSignals: [reason], state: "blocked" }),
        }),
      });
    },
  );
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

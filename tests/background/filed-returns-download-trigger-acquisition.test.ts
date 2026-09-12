import { describe, expect, it, vi } from "vitest";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";
import type { acquireFiledReturnJsonInMainWorld } from "../../src/background/filed-returns-json-acquisition";
import type { acquireGstr3bPdfAfterPreflight } from "../../src/background/gstr3b-artifact-acquisition";
import type { stageOffscreenFiledReturn } from "../../src/background/offscreen-blob-url";
import { parseDurableFiledReturnsSignals } from "../../src/connectors/gst/filed-returns-durable-signals";

type JsonAcquisitionInput = Parameters<typeof acquireFiledReturnJsonInMainWorld>[0];
type Gstr3bPdfAcquisitionInput = Parameters<typeof acquireGstr3bPdfAfterPreflight>[0];
type Gstr3bPdfAcquisitionResult = ReturnType<typeof acquireGstr3bPdfAfterPreflight>;
type StageOffscreenFiledReturnResult = ReturnType<typeof stageOffscreenFiledReturn>;

const captureMocks = vi.hoisted(() => ({
  acquireGstr3bPdfAfterPreflight: vi.fn<
    (input: Gstr3bPdfAcquisitionInput) => Gstr3bPdfAcquisitionResult
  >(async () => ({
    downloadId: 91,
    ok: true as const,
    safeSignals: [] as string[],
  })),
  acquirePageGeneratedArtifact: vi.fn(async () => ({
    ok: true as const,
    bytes: new Uint8Array([0x50, 0x4b]),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    safeSignals: [] as string[],
  })),
  acquireFiledReturnJsonInMainWorld: vi.fn(async (input: JsonAcquisitionInput) =>
    input.deliver
      ? input.deliver({ base64: "e30=", mimeType: "application/json" })
      : {
          downloadId: 91,
          ok: true as const,
          safeMessage: undefined as string | undefined,
          safeSignals: [] as string[],
        },
  ),
  downloadAcquiredArtifact: vi.fn(async () => ({
    ok: true as const,
    downloadId: 91,
    bytesReceived: 128,
    safeMessage: undefined as string | undefined,
    safeSignals: [] as string[],
  })),
  clearArtifactAcquisitionCheckpoint: vi.fn(async () => undefined),
  persistArtifactAcquisitionDownloadId: vi.fn(async () => undefined),
  persistArtifactAcquisitionIntent: vi.fn(async () => undefined),
  persistArtifactAcquisitionUnconfirmedDownload: vi.fn(async () => undefined),
  stageOffscreenFiledReturn: vi.fn<() => StageOffscreenFiledReturnResult>(async () => ({
    status: "staged" as const,
  })),
}));
const summaryStorage = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  remove: vi.fn(async () => undefined),
  set: vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(summaryStorage.values, values);
  }),
}));
const reviewStorage = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  get: vi.fn(async (key: string) => ({ [key]: reviewStorage.values[key] })),
  remove: vi.fn(async (key: string) => {
    delete reviewStorage.values[key];
  }),
  set: vi.fn(async (values: Record<string, unknown>) =>
    Object.assign(reviewStorage.values, values),
  ),
}));

vi.mock("wxt/browser", () => ({
  browser: { storage: { local: reviewStorage, session: summaryStorage } },
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
vi.mock("../../src/background/filed-returns-json-acquisition", () => ({
  acquireFiledReturnJsonInMainWorld: captureMocks.acquireFiledReturnJsonInMainWorld,
}));
vi.mock("../../src/background/offscreen-blob-url", () => ({
  stageOffscreenFiledReturn: captureMocks.stageOffscreenFiledReturn,
}));

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
import { withPersistedSinglePeriodSummary } from "../../src/background/filed-returns-single-period-summary";
import { FILED_RETURNS_RETURN_TYPES } from "../../src/connectors/gst/filed-returns-return-types";
import { filedReturnScopeId } from "../../src/connectors/gst/filed-returns-return-descriptors";
import {
  PACK_LOCAL_STORAGE_KEYS,
  PACK_SESSION_STORAGE_KEYS,
} from "../../src/background/storage-keys";

const ARTIFACT_ACQUISITION_RETURN_TYPES = FILED_RETURNS_RETURN_TYPES;

describe("GSTR-3B artifact acquisition dispatch", () => {
  it.each([
    ["April", "PDF"],
    ["March", "JSON"],
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
      activePeriod: period,
      artifactType,
      deps: { sendMessageToTabWithInjection, storageKeys: {} },
      scope: { financialYear: "2025-26", period, returnType: "GSTR-3B" },
      tabId: 17,
    });

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining(["artifact-generation-timeout"]),
        state: "blocked",
      },
    });
    expect(sendMessageToTabWithInjection).toHaveBeenCalledWith(
      17,
      expect.objectContaining({ type: "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34" }),
    );
    expect(sendMessageToTabWithInjection).not.toHaveBeenCalledWith(
      17,
      expect.objectContaining({ type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3" }),
    );
  });

  it.each(["PDF", "JSON"] as const)(
    "blocks raw full-year GSTR-3B %s acquisition before it can create an artifact download",
    async (artifactType) => {
      vi.clearAllMocks();
      const sendMessageToTabWithInjection = vi.fn();

      const response = await triggerAndObserveFiledReturnDownload({
        activePeriod: null,
        artifactType,
        deps: { sendMessageToTabWithInjection, storageKeys: {} },
        scope: { financialYear: "2026-27", period: "ALL", returnType: "GSTR-3B" },
        tabId: 17,
      });

      expect(response).toMatchObject({
        flowStep: {
          safeSignals: expect.arrayContaining(["gstr3b-full-fiscal-year-acquisition-not-wired"]),
          state: "blocked",
        },
      });
      expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
      expect(captureMocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
    },
  );

  it("stages a GSTR-3B PDF for a full-year ZIP without creating an artifact download", async () => {
    vi.clearAllMocks();
    captureMocks.acquireGstr3bPdfAfterPreflight.mockImplementationOnce(async (input) => {
      if (!input.deliver) throw new Error("expected staged delivery");
      return input.deliver({ base64: "JVBERi0xLjc=", mimeType: "application/pdf" });
    });

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "June",
      artifactType: "PDF",
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async (_tabId, message) =>
            ({
              ok: true,
              artifact: {
                ok: true,
                state: "ready",
                requestId: message.payload.requestId,
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        stageCapturedDownloads: {
          bundleKind: "full-fiscal-year",
          ledgerId: "full-fiscal-year:12345678-test",
        },
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-3B" },
      tabId: 17,
    });

    expect(captureMocks.stageOffscreenFiledReturn).toHaveBeenCalledOnce();
    expect(captureMocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
    expect(captureMocks.persistArtifactAcquisitionIntent).not.toHaveBeenCalled();
    expect(captureMocks.clearArtifactAcquisitionCheckpoint).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      flowStep: {
        downloadDiagnostic: {
          endpointClass: "gstr3b-portal-blob-captured-download",
        },
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-opfs-staged",
          "full-fiscal-year-opfs-staged:PDF",
        ]),
        state: "downloaded",
      },
    });
  });

  it.each([
    "blob-url-failed",
    "invalid-data-url",
    "opfs-unavailable",
    "stage-failed",
    "unexpected-local-stage-category",
  ])("keeps a full-year GSTR-3B staging failure durable: %s", async (errorCategory) => {
    vi.clearAllMocks();
    captureMocks.acquireGstr3bPdfAfterPreflight.mockImplementationOnce(async (input) => {
      if (!input.deliver) throw new Error("expected staged delivery");
      return input.deliver({ base64: "JVBERi0xLjc=", mimeType: "application/pdf" });
    });
    captureMocks.stageOffscreenFiledReturn.mockResolvedValueOnce({
      status: "failed",
      errorCategory,
    });

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "PDF",
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async (_tabId, message) =>
            ({
              ok: true,
              artifact: {
                ok: true,
                state: "ready",
                requestId: message.payload.requestId,
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        stageCapturedDownloads: {
          bundleKind: "full-fiscal-year",
          ledgerId: "full-fiscal-year:12345678-test",
        },
        storageKeys: {},
      },
      scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-3B" },
      tabId: 17,
    });

    if (!response.ok || !("flowStep" in response)) throw new Error("expected flow step");
    const expectedReason = (
      errorCategory === "unexpected-local-stage-category"
        ? "offscreen-response-invalid"
        : errorCategory
    ) as ArtifactFailureReason;
    expect(response.flowStep).toMatchObject({
      state: "blocked",
      safeMessage: ARTIFACT_FAILURE_MESSAGES[expectedReason],
      safeSignals: expect.arrayContaining([`artifact-${expectedReason}`]),
    });
    expect(parseDurableFiledReturnsSignals(response.flowStep.safeSignals)).toEqual(
      response.flowStep.safeSignals,
    );
  });

  it("keeps a rejected full-year staging worker request distinct from delivery uncertainty", async () => {
    vi.clearAllMocks();
    captureMocks.acquireGstr3bPdfAfterPreflight.mockImplementationOnce(async (input) => {
      if (!input.deliver) throw new Error("expected staged delivery");
      return input.deliver({ base64: "JVBERi0xLjc=", mimeType: "application/pdf" });
    });
    captureMocks.stageOffscreenFiledReturn.mockRejectedValueOnce(
      new Error("synthetic offscreen request rejection"),
    );

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "PDF",
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async (_tabId, message) =>
            ({
              ok: true,
              artifact: {
                ok: true,
                state: "ready",
                requestId: message.payload.requestId,
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        stageCapturedDownloads: {
          bundleKind: "full-fiscal-year",
          ledgerId: "full-fiscal-year:12345678-test",
        },
        storageKeys: {},
      },
      scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-3B" },
      tabId: 17,
    });

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeMessage: ARTIFACT_FAILURE_MESSAGES["offscreen-unreachable"],
        safeSignals: expect.arrayContaining(["artifact-offscreen-unreachable"]),
      },
    });
  });

  it("stages GSTR-3B JSON for a full-year ZIP without creating an artifact download", async () => {
    vi.clearAllMocks();
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "June",
      artifactType: "JSON",
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async (_tabId, message) =>
            ({
              ok: true,
              artifact: {
                ok: true,
                state: "ready",
                requestId: message.payload.requestId,
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        stageCapturedDownloads: {
          bundleKind: "full-fiscal-year",
          ledgerId: "full-fiscal-year:12345678-test",
        },
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-3B" },
      tabId: 17,
    });

    expect(captureMocks.stageOffscreenFiledReturn).toHaveBeenCalledOnce();
    expect(captureMocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
    expect(captureMocks.persistArtifactAcquisitionIntent).not.toHaveBeenCalled();
    expect(captureMocks.clearArtifactAcquisitionCheckpoint).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      flowStep: {
        downloadDiagnostic: {
          endpointClass: "gstr3b-main-world-json-captured-download",
        },
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-opfs-staged",
          "full-fiscal-year-opfs-staged:JSON",
        ]),
        state: "downloaded",
      },
    });
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

  it("hands prepared JSON to the service-worker MAIN-world path", async () => {
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

    expect(response).toMatchObject({
      flowStep: {
        downloadDiagnostic: {
          artifactType: "JSON",
          byteCountClass: "non-empty",
          downloadId: 91,
          endpointClass: "gstr3b-main-world-json-captured-download",
          mimeClass: "json",
          status: "downloaded",
        },
        state: "downloaded",
      },
    });
    expect(captureMocks.acquireFiledReturnJsonInMainWorld).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "ComplyEaze-Pack/2026-27/GSTR-3B/June-data.json",
      }),
    );
  });

  it("surfaces a completed JSON filename override without treating the target as failed", async () => {
    captureMocks.acquireFiledReturnJsonInMainWorld.mockResolvedValueOnce({
      downloadId: 91,
      ok: true,
      safeMessage:
        "Another extension changed where this file was saved. Check browser Downloads before using it.",
      safeSignals: ["download-filename-overridden"] as string[],
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
          "Another extension changed where this file was saved. Check browser Downloads before using it.",
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

    expect(response).toMatchObject({
      flowStep: {
        downloadDiagnostic: {
          artifactType: "PDF",
          byteCountClass: "non-empty",
          downloadId: 91,
          mimeClass: "pdf",
          status: "downloaded",
        },
        state: "downloaded",
      },
    });
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
  it("stages a bundled artifact without reporting or starting a loose download", async () => {
    vi.clearAllMocks();
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "June",
      artifactType: "PDF",
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async (_tabId, message) =>
            ({
              ok: true,
              artifact: {
                ok: true,
                state: "ready",
                requestId: message.payload.requestId,
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        stageCapturedDownloads: {
          bundleKind: "single-period",
          ledgerId: "single-period:12345678-test",
        },
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-2B" },
      tabId: 17,
    });

    expect(captureMocks.stageOffscreenFiledReturn).toHaveBeenCalledOnce();
    expect(captureMocks.downloadAcquiredArtifact).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      flowStep: {
        state: "downloaded",
        safeSignals: expect.arrayContaining([
          "single-period-opfs-staged",
          "single-period-opfs-staged:PDF",
        ]),
      },
    });
    if (!response.ok || !("flowStep" in response)) throw new Error("expected flow step");
    expect(response.flowStep.safeSignals).not.toContain("extension-download-complete");
  });

  it("does not apply the GSTR-1 visible-scope guard to GSTR-2B acquisition", async () => {
    const sendMessageToTabWithInjection = vi.fn(
      async (_tabId, message) =>
        ({
          ok: true,
          artifact: {
            ok: true,
            state: "ready",
            requestId: message.payload.requestId,
            safeSignals: ["target-period-verified"],
          },
        }) as PackMessageResponse,
    );

    const response = await triggerAndObserveFiledReturnDownload({
      activeFinancialYear: "2025-26",
      activePeriod: "May",
      artifactType: "PDF",
      deps: {
        sendMessageToTabWithInjection,
        stageCapturedDownloads: {
          bundleKind: "single-period",
          ledgerId: "single-period:12345678-test",
        },
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-2B" },
      tabId: 17,
    });

    expect(sendMessageToTabWithInjection).toHaveBeenCalledOnce();
    expect(response).toMatchObject({ flowStep: { state: "downloaded" } });
  });

  it("turns a malformed April summary-page response into a terminal message", async () => {
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
        safeSignals: expect.arrayContaining(["gstr2b-artifact-content-unavailable"]),
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
    [Gstr2bArtifactDispatchFailureReason.ContentUnavailable, "April", "PDF", { ok: true }],
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
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "June",
      artifactType: "JSON",
      deps: {
        sendMessageToTabWithInjection: vi.fn(
          async (_tabId, message) =>
            ({
              ok: true,
              artifact: {
                ok: true,
                state: "ready",
                requestId: message.payload.requestId,
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-2B" },
      tabId: 17,
    });

    expect(captureMocks.acquireFiledReturnJsonInMainWorld).toHaveBeenCalledWith(
      expect.objectContaining({
        deliver: expect.any(Function),
        filename: "ComplyEaze-Pack/2026-27/GSTR-2B/June-data.json",
      }),
    );
    expect(response).toMatchObject({
      flowStep: {
        downloadDiagnostic: {
          artifactType: "JSON",
          downloadId: 91,
          endpointClass: "gstr2b-main-world-json-captured-download",
          mimeClass: "json",
        },
        state: "downloaded",
      },
    });
  });

  it("keeps GSTR-2B JSON inside a selected-file staging handoff", async () => {
    vi.clearAllMocks();

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
                state: "ready",
                requestId: message.payload.requestId,
                safeSignals: ["target-period-verified"],
              },
            }) as PackMessageResponse,
        ),
        stageCapturedDownloads: { bundleKind: "single-period", ledgerId: "single-period-test" },
        storageKeys: {},
      },
      scope: { financialYear: "2026-27", period: "June", returnType: "GSTR-2B" },
      tabId: 17,
    });

    expect(captureMocks.acquireFiledReturnJsonInMainWorld).toHaveBeenCalledWith(
      expect.objectContaining({ deliver: expect.any(Function) }),
    );
    expect(captureMocks.persistArtifactAcquisitionIntent).not.toHaveBeenCalled();
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
  it.each([
    ["period", "June", "2026-27", "April", "2026-27"],
    ["financial year", "April", "2025-26", "April", "2026-27"],
  ] as const)(
    "blocks acquisition when the visible %s differs from the requested scope",
    async (_field, activePeriod, activeFinancialYear, requestedPeriod, requestedFinancialYear) => {
      const sendMessageToTabWithInjection = vi.fn();
      captureMocks.acquirePageGeneratedArtifact.mockClear();

      const response = await triggerAndObserveFiledReturnDownload({
        activeFinancialYear,
        activePeriod,
        artifactType: "PDF",
        deps: { sendMessageToTabWithInjection, storageKeys: {} },
        scope: {
          financialYear: requestedFinancialYear,
          period: requestedPeriod,
          returnType: "GSTR-1",
        },
        tabId: 17,
      });

      expect(response).toMatchObject({
        flowStep: {
          safeSignals: expect.arrayContaining(["filed-gstr1-visible-scope-mismatch"]),
          state: "blocked",
          userAction: { type: "NAVIGATE_TO_SUPPORTED_PAGE", canResume: true },
        },
      });
      if (!response.ok || !("flowStep" in response)) throw new Error("Expected flow step.");
      expect(response.flowStep.safeMessage).toContain(`${activePeriod} ${activeFinancialYear}`);
      expect(response.flowStep.safeMessage).toContain(
        `${requestedPeriod} ${requestedFinancialYear}`,
      );
      expect(sendMessageToTabWithInjection).not.toHaveBeenCalled();
      expect(captureMocks.acquirePageGeneratedArtifact).not.toHaveBeenCalled();
    },
  );

  it.each(["PDF", "EXCEL"] as const)(
    "uses the bounded portal shim for the %s artifact",
    async (artifactType) => {
      const response = await triggerAndObserveFiledReturnDownload({
        activeFinancialYear: "2026-27",
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
    [Gstr1ArtifactDispatchFailureReason.ContentUnavailable, "April", "PDF", undefined],
    [Gstr1ArtifactDispatchFailureReason.ContentUnavailable, "April", "PDF", {}],
    [Gstr1ArtifactDispatchFailureReason.ContentUnavailable, "April", "PDF", { ok: true }],
    [
      Gstr1ArtifactDispatchFailureReason.ContentUnavailable,
      "April",
      "PDF",
      { ok: true, artifact: null },
    ],
    [
      Gstr1ArtifactDispatchFailureReason.ContentUnavailable,
      "April",
      "PDF",
      { ok: true, artifact: "x" },
    ],
    [
      Gstr1ArtifactDispatchFailureReason.ContentUnavailable,
      "April",
      "PDF",
      { ok: false, error: { category: "synthetic" } },
    ],
    [
      Gstr1ArtifactDispatchFailureReason.ContentUnavailable,
      "April",
      "PDF",
      {
        ok: true,
        artifact: {
          ok: true,
          requestId: "synthetic-gstr1-request",
          safeSignals: ["target-period-verified"],
          state: "ready",
        },
        unexpected: "must-not-pass-through",
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
          sendMessageToTabWithInjection: vi.fn(async () => reply as unknown as PackMessageResponse),
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
      state: "ready",
      requestId: "synthetic-request",
      safeSignals: [],
    },
  };
}

describe("filed GSTR-1 e-invoice Excel with no details to download", () => {
  // A definitive acquisition failure may be refined by the typed, target-bound inspection result.
  // An uncertain acquisition takes the recovery branch tested below and never reaches this path.
  function messagingDeps(postClick: PackMessageResponse) {
    return vi.fn(async (_tabId: number, message: { type: string }) =>
      message.type === "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3"
        ? postClick
        : ({
            ok: true,
            artifact: {
              ok: true,
              state: "ready",
              requestId: "synthetic-request",
              safeSignals: ["target-period-verified"],
            },
          } as PackMessageResponse),
    );
  }

  const noDetailsStep = {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId("GSTR-1"),
      state: "blocked",
      safeSignals: ["filed-gstr1-excel-no-details-available", "filed-gstr1-detail-period-verified"],
      safeMessage: "The GST Portal reported that no e-invoice details are available.",
    },
  } as PackMessageResponse;

  const gstr2bNotGeneratedStep = {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId("GSTR-2B"),
      state: "blocked",
      safeSignals: [
        "filed-gstr2b-not-generated",
        "gstr2b-summary-route-verified",
        "gstr2b-visible-period-verified",
      ],
      safeMessage: "The GST Portal reported that this GSTR-2B is not generated.",
    },
  } as PackMessageResponse;

  function armDefinitiveNoActionFailure() {
    captureMocks.acquirePageGeneratedArtifact.mockResolvedValueOnce({
      ok: false as const,
      reason: "control-not-found",
      safeSignals: [] as string[],
    } as never);
  }

  it("adopts a target-bound no-details answer after a definitive acquisition failure", async () => {
    armDefinitiveNoActionFailure();
    const sendMessageToTabWithInjection = messagingDeps(noDetailsStep);

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "EXCEL",
      deps: { sendMessageToTabWithInjection, storageKeys: {} },
      scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-1" },
      tabId: 17,
    });

    expect(sendMessageToTabWithInjection).toHaveBeenCalledWith(
      17,
      expect.objectContaining({ type: "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3" }),
    );
    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining(["filed-gstr1-excel-no-details-available"]),
        // Still blocked. This records an absence; it never turns a click into a download.
        state: "blocked",
      },
    });
  });

  it("persists the declined terminal answer before clearing its acquisition checkpoint", async () => {
    armDefinitiveNoActionFailure();
    const sendMessageToTabWithInjection = messagingDeps(noDetailsStep);
    const persistedBefore = summaryStorage.set.mock.calls.length;
    const clearedBefore = captureMocks.clearArtifactAcquisitionCheckpoint.mock.calls.length;

    await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "EXCEL",
      deps: { sendMessageToTabWithInjection, storageKeys: { completion: "completion" } },
      scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-1" },
      tabId: 17,
    });

    expect(summaryStorage.set).toHaveBeenCalledWith({
      completion: expect.objectContaining({
        completedPeriods: ["April"],
        status: "complete",
      }),
    });
    expect(captureMocks.clearArtifactAcquisitionCheckpoint).toHaveBeenCalled();
    expect(summaryStorage.set.mock.invocationCallOrder[persistedBefore]).toBeLessThan(
      captureMocks.clearArtifactAcquisitionCheckpoint.mock.invocationCallOrder[clearedBefore]!,
    );
  });

  it("clears the exact persisted target review after a durable definitive refusal", async () => {
    armDefinitiveNoActionFailure();
    reviewStorage.values = {};
    summaryStorage.values = {};
    const scope = { financialYear: "2025-26", period: "April", returnType: "GSTR-1" } as const;

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "EXCEL",
      deps: {
        sendMessageToTabWithInjection: messagingDeps(noDetailsStep),
        storageKeys: {
          completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
          targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
        },
      },
      scope,
      tabId: 17,
    });
    const persisted = await withPersistedSinglePeriodSummary(
      { ...scope, artifactType: "EXCEL" },
      response as Extract<PackMessageResponse, { ok: true; flowStep: never }>,
      {
        storageKeys: {
          completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
          targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
        },
      } as never,
      true,
    );

    expect(reviewStorage.set).toHaveBeenCalledWith(
      expect.objectContaining({ [PACK_LOCAL_STORAGE_KEYS.targetReview]: expect.any(Object) }),
    );
    expect(reviewStorage.remove).toHaveBeenCalledWith(PACK_LOCAL_STORAGE_KEYS.targetReview);
    expect(reviewStorage.values[PACK_LOCAL_STORAGE_KEYS.targetReview]).toBeUndefined();
    expect(persisted).toMatchObject({ flowSummary: { status: "complete" } });

    armDefinitiveNoActionFailure();
    await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "EXCEL",
      deps: {
        sendMessageToTabWithInjection: messagingDeps(noDetailsStep),
        storageKeys: {
          completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
          targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
        },
      },
      scope,
      tabId: 17,
    });
    expect(reviewStorage.set).toHaveBeenCalledTimes(2);
    expect(reviewStorage.remove).toHaveBeenCalledTimes(2);
  });

  it("keeps a clear refusal blocked and resumable through outer summary persistence", async () => {
    armDefinitiveNoActionFailure();
    reviewStorage.values = {};
    summaryStorage.values = {};
    reviewStorage.remove.mockRejectedValueOnce(
      new Error("Synthetic target-review remove failure."),
    );
    const scope = { financialYear: "2025-26", period: "April", returnType: "GSTR-1" } as const;
    const storageKeys = {
      completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
      targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
    };

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "EXCEL",
      deps: { sendMessageToTabWithInjection: messagingDeps(noDetailsStep), storageKeys },
      scope,
      tabId: 17,
    });
    const persisted = await withPersistedSinglePeriodSummary(
      { ...scope, artifactType: "EXCEL" },
      response as Extract<PackMessageResponse, { ok: true; flowStep: never }>,
      { storageKeys } as never,
      true,
    );

    expect(persisted).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-gstr1-excel-no-details-available",
          "filed-returns-target-review-clear-failed",
          "filed-returns-target-review-clear-failed:storage-remove-failed",
        ]),
        state: "download-unconfirmed",
        userAction: { canResume: true, type: "RETRY_PORTAL_GENERATION" },
      },
      flowSummary: { status: "blocked" },
    });
    expect(
      summaryStorage.values[PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary],
    ).toMatchObject({
      status: "blocked",
    });
    expect(reviewStorage.values[PACK_LOCAL_STORAGE_KEYS.targetReview]).toMatchObject({
      scope: { ...scope, artifactType: "EXCEL" },
    });
  });

  it("keeps a target-review read throw blocked and resumable through outer summary persistence", async () => {
    armDefinitiveNoActionFailure();
    reviewStorage.values = {};
    summaryStorage.values = {};
    reviewStorage.get
      .mockImplementationOnce(async (key: string) => ({ [key]: reviewStorage.values[key] }))
      .mockRejectedValueOnce(new Error("Synthetic target-review read failure."));
    const scope = { financialYear: "2025-26", period: "April", returnType: "GSTR-1" } as const;
    const storageKeys = {
      completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
      targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
    };

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "EXCEL",
      deps: { sendMessageToTabWithInjection: messagingDeps(noDetailsStep), storageKeys },
      scope,
      tabId: 17,
    });
    const persisted = await withPersistedSinglePeriodSummary(
      { ...scope, artifactType: "EXCEL" },
      response as Extract<PackMessageResponse, { ok: true; flowStep: never }>,
      { storageKeys } as never,
      true,
    );

    expect(persisted).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-gstr1-excel-no-details-available",
          "filed-returns-target-review-clear-failed:storage-read-failed",
        ]),
        userAction: { canResume: true },
      },
      flowSummary: { status: "blocked" },
    });
    expect(reviewStorage.values[PACK_LOCAL_STORAGE_KEYS.targetReview]).toMatchObject({
      scope: { ...scope, artifactType: "EXCEL" },
    });
  });

  it("keeps a GSTR-2B clear refusal blocked and resumable through outer summary persistence", async () => {
    armDefinitiveNoActionFailure();
    reviewStorage.values = {};
    summaryStorage.values = {};
    reviewStorage.remove.mockRejectedValueOnce(
      new Error("Synthetic target-review remove failure."),
    );
    const scope = { financialYear: "2025-26", period: "April", returnType: "GSTR-2B" } as const;
    const storageKeys = {
      completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
      targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
    };

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "PDF",
      deps: { sendMessageToTabWithInjection: messagingDeps(gstr2bNotGeneratedStep), storageKeys },
      scope,
      tabId: 17,
    });
    const persisted = await withPersistedSinglePeriodSummary(
      { ...scope, artifactType: "PDF" },
      response as Extract<PackMessageResponse, { ok: true; flowStep: never }>,
      { storageKeys } as never,
      true,
    );

    expect(persisted).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-gstr2b-not-generated",
          "filed-returns-target-review-clear-failed:storage-remove-failed",
        ]),
        userAction: { canResume: true },
      },
      flowSummary: { status: "blocked" },
    });
    expect(reviewStorage.values[PACK_LOCAL_STORAGE_KEYS.targetReview]).toMatchObject({
      scope: { ...scope, artifactType: "PDF" },
    });
  });

  it("keeps a GSTR-2B target-review read throw blocked and resumable through outer summary persistence", async () => {
    armDefinitiveNoActionFailure();
    reviewStorage.values = {};
    summaryStorage.values = {};
    reviewStorage.get
      .mockImplementationOnce(async (key: string) => ({ [key]: reviewStorage.values[key] }))
      .mockRejectedValueOnce(new Error("Synthetic target-review read failure."));
    const scope = { financialYear: "2025-26", period: "April", returnType: "GSTR-2B" } as const;
    const storageKeys = {
      completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
      targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
    };

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "PDF",
      deps: { sendMessageToTabWithInjection: messagingDeps(gstr2bNotGeneratedStep), storageKeys },
      scope,
      tabId: 17,
    });
    const persisted = await withPersistedSinglePeriodSummary(
      { ...scope, artifactType: "PDF" },
      response as Extract<PackMessageResponse, { ok: true; flowStep: never }>,
      { storageKeys } as never,
      true,
    );

    expect(persisted).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-gstr2b-not-generated",
          "filed-returns-target-review-clear-failed:storage-read-failed",
        ]),
        userAction: { canResume: true },
      },
      flowSummary: { status: "blocked" },
    });
    expect(reviewStorage.values[PACK_LOCAL_STORAGE_KEYS.targetReview]).toMatchObject({
      scope: { ...scope, artifactType: "PDF" },
    });
  });

  it("does not write a single-period summary for a staged full-year refusal", async () => {
    armDefinitiveNoActionFailure();
    summaryStorage.set.mockRejectedValueOnce(new Error("Synthetic session write failure."));
    const persistedBefore = summaryStorage.set.mock.calls.length;

    await expect(
      triggerAndObserveFiledReturnDownload({
        activePeriod: "April",
        artifactType: "EXCEL",
        deps: {
          sendMessageToTabWithInjection: messagingDeps(noDetailsStep),
          stageCapturedDownloads: {
            bundleKind: "full-fiscal-year",
            ledgerId: "full-fiscal-year:test",
          },
          storageKeys: { completion: "completion" },
        },
        scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-1" },
        tabId: 17,
      }),
    ).resolves.toMatchObject({ flowStep: { state: "blocked" } });
    expect(summaryStorage.set.mock.calls.length).toBe(persistedBefore);
    summaryStorage.set.mockResolvedValue(undefined);
  });

  it("retains an uncertain acquisition instead of adopting a later decline", async () => {
    captureMocks.acquirePageGeneratedArtifact.mockResolvedValueOnce({
      ok: false as const,
      reason: "generation-timeout",
      safeSignals: [] as string[],
    } as never);
    const sendMessageToTabWithInjection = messagingDeps(noDetailsStep);
    const persistedBefore = summaryStorage.set.mock.calls.length;
    const clearedBefore = captureMocks.clearArtifactAcquisitionCheckpoint.mock.calls.length;

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "EXCEL",
      deps: { sendMessageToTabWithInjection, storageKeys: { completion: "completion" } },
      scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-1" },
      tabId: 17,
    });

    expect(sendMessageToTabWithInjection).not.toHaveBeenCalledWith(
      17,
      expect.objectContaining({ type: "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3" }),
    );
    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining(["artifact-generation-timeout"]),
        state: "blocked",
      },
    });
    if (!response.ok || !("flowStep" in response)) throw new Error("Expected flow step.");
    expect(response.flowStep.safeSignals).not.toContain("filed-gstr1-excel-no-details-available");
    expect(summaryStorage.set.mock.calls.length).toBe(persistedBefore);
    expect(captureMocks.clearArtifactAcquisitionCheckpoint.mock.calls.length).toBe(clearedBefore);
    expect(captureMocks.persistArtifactAcquisitionIntent).toHaveBeenCalled();
  });

  it("retains the checkpoint when terminal-decline persistence throws", async () => {
    summaryStorage.set.mockReset();
    summaryStorage.set.mockResolvedValue(undefined);
    armDefinitiveNoActionFailure();
    const sendMessageToTabWithInjection = messagingDeps(noDetailsStep);
    const clearedBefore = captureMocks.clearArtifactAcquisitionCheckpoint.mock.calls.length;
    summaryStorage.set.mockRejectedValueOnce(new Error("Synthetic storage failure."));

    await expect(
      triggerAndObserveFiledReturnDownload({
        activePeriod: "April",
        artifactType: "EXCEL",
        deps: { sendMessageToTabWithInjection, storageKeys: { completion: "completion" } },
        scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-1" },
        tabId: 17,
      }),
    ).rejects.toThrow("Synthetic storage failure.");

    expect(captureMocks.clearArtifactAcquisitionCheckpoint.mock.calls.length).toBe(clearedBefore);
  });

  it("keeps the original failure when the page cannot be asked at all", async () => {
    // This runs after an acquisition has already failed and can only refine that failure. A tab
    // that has closed, navigated, or refuses injection means the failure cannot be refined -- not
    // that a new one happened. Throwing here would replace a specific, actionable reason with the
    // generic background error and lose the terminal summary with it.
    armDefinitiveNoActionFailure();
    const sendMessageToTabWithInjection = vi.fn(
      async (_tabId: number, message: { type: string }) => {
        if (message.type === "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3") {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }
        return {
          ok: true,
          artifact: {
            ok: true,
            state: "ready",
            requestId: "synthetic-request",
            safeSignals: ["target-period-verified"],
          },
        } as PackMessageResponse;
      },
    );

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "EXCEL",
      deps: { sendMessageToTabWithInjection, storageKeys: {} },
      scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-1" },
      tabId: 17,
    });

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "artifact-acquisition-failed",
          "artifact-control-not-found",
        ]),
        state: "blocked",
      },
    });
  });

  it("keeps the original failure when the page reports no recognised block", async () => {
    armDefinitiveNoActionFailure();
    const sendMessageToTabWithInjection = messagingDeps({
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "filed-returns:gstr-1",
        state: "candidate-not-found",
        safeSignals: ["filed-return-post-click-blocked-state-not-found"],
        safeMessage: "Pack did not find a recognized post-click portal block.",
      },
    } as PackMessageResponse);

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "April",
      artifactType: "EXCEL",
      deps: { sendMessageToTabWithInjection, storageKeys: {} },
      scope: { financialYear: "2025-26", period: "April", returnType: "GSTR-1" },
      tabId: 17,
    });

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining(["artifact-acquisition-failed"]),
        state: "blocked",
      },
    });
  });
});

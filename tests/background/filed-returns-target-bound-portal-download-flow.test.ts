import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadCreatedItem, DownloadDelta } from "../../src/background/download-observer";

const mocks = vi.hoisted(() => {
  const createdListeners = new Set<(item: DownloadCreatedItem) => void>();
  const changedListeners = new Set<(delta: DownloadDelta) => void>();
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const events: string[] = [];
  return {
    browser: {
      downloads: {
        download: vi.fn(async () => 99),
        onChanged: {
          addListener: vi.fn((listener: (delta: DownloadDelta) => void) =>
            changedListeners.add(listener),
          ),
          removeListener: vi.fn((listener: (delta: DownloadDelta) => void) =>
            changedListeners.delete(listener),
          ),
        },
        onCreated: {
          addListener: vi.fn((listener: (item: DownloadCreatedItem) => void) =>
            createdListeners.add(listener),
          ),
          removeListener: vi.fn((listener: (item: DownloadCreatedItem) => void) =>
            createdListeners.delete(listener),
          ),
        },
        search: vi.fn(async (_query?: { id: number }) => {
          void _query;
          return [] as DownloadCreatedItem[];
        }),
      },
      scripting: {
        executeScript: vi.fn(async () => [] as unknown[]),
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) =>
            Object.hasOwn(local, key) ? { [key]: local[key] } : {},
          ),
          remove: vi.fn(async (key: string) => {
            events.push("storage:review-cleared");
            delete local[key];
          }),
          set: vi.fn(async (values: Record<string, unknown>) => {
            const review = values["target-review"] as
              { downloadAttempt?: { phase?: string } } | undefined;
            if (review?.downloadAttempt?.phase === "download-intent-persisted") {
              events.push("storage:intent");
            }
            if (review?.downloadAttempt?.phase === "target-bound-candidate-observing") {
              events.push("storage:candidate-id");
            }
            if (review?.downloadAttempt?.phase === "download-observing") {
              events.push("storage:exact-id");
            }
            Object.assign(local, values);
          }),
        },
        session: {
          get: vi.fn(async (key: string) =>
            Object.hasOwn(session, key) ? { [key]: session[key] } : {},
          ),
          remove: vi.fn(async (key: string) => {
            delete session[key];
          }),
          set: vi.fn(async (values: Record<string, unknown>) => {
            events.push("storage:completion");
            Object.assign(session, values);
          }),
        },
      },
    },
    changedListeners,
    createdListeners,
    events,
    local,
    session,
  };
});

vi.mock("wxt/browser", () => ({ browser: mocks.browser }));

import { triggerAndObserveFiledReturnDownload } from "../../src/background/filed-returns-download-trigger";
import { readCurrentFiledReturnsFlowSummary } from "../../src/background/filed-returns-current-state";

const ARMED_AT = new Date("2026-06-24T00:00:00.000Z");
const TARGET_ACTION_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_FILENAME_NONCE = "00000000000040008000000000000001";
describe("target-bound portal-created GSTR-3B handoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ARMED_AT);
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(TARGET_ACTION_ID);
    mocks.createdListeners.clear();
    mocks.changedListeners.clear();
    mocks.events.length = 0;
    for (const key of Object.keys(mocks.local)) delete mocks.local[key];
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("persists intent before the click and completes only the exact native download ID", async () => {
    const item: DownloadCreatedItem = {
      bytesReceived: 2048,
      danger: "safe",
      exists: true,
      fileSize: 2048,
      filename: `/synthetic/GSTR3B_052026_pack-${TARGET_FILENAME_NONCE}.pdf`,
      finalUrl: "blob:https://return.gst.gov.in/synthetic-final",
      id: 81,
      incognito: false,
      mime: "application/pdf",
      referrer: "",
      startTime: "2026-06-24T00:00:00.250Z",
      state: "complete",
      totalBytes: 2048,
      url: "blob:https://return.gst.gov.in/synthetic-source",
    };
    mocks.browser.downloads.search.mockImplementation(async (query?: { id: number }) =>
      query?.id === item.id ? [item] : [],
    );
    mocks.browser.scripting.executeScript.mockImplementationOnce(async () => {
      mocks.events.push("capture:clicked");
      for (const listener of mocks.createdListeners) listener(item);
      return [
        {
          result: {
            capturedDownloadRequest: null,
            safeFailureSignals: [
              "filed-gstr3b-main-world-capture-armed",
              "filed-gstr3b-unbound-create-object-url-ignored",
              "filed-gstr3b-target-bound-native-blob-click-delegated",
            ],
            targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
          },
        },
      ];
    });

    const responsePromise = triggerAndObserveFiledReturnDownload({
      activePeriod: "May",
      artifactType: "PDF",
      deps: {
        now: () => ARMED_AT,
        portalTabIncognito: false,
        sendMessageToTabWithInjection: vi.fn(async (_tabId, message) => ({
          ok: true as const,
          mainWorldCaptureRequest: {
            actionId: message.payload.actionId,
            controlAttribute: "data-pack-capture-action",
            controlId: "synthetic-gstr3b-pdf-control",
            maxBytes: 36 * 1024 * 1024,
            signalPrefix: "filed-gstr3b",
            targetBinding: {
              artifactType: "PDF" as const,
              controlTextDigest: "a".repeat(64),
              financialYear: "2026-27",
              pathnameDigest: "b".repeat(64),
              period: "May" as const,
              returnType: "GSTR-3B" as const,
            },
            timeoutMs: 30_000,
          },
          downloadTrigger: {
            connectorId: "gst" as const,
            safeMessage: "Synthetic capture prepared.",
            safeSignals: [
              "filed-return-download-clicked",
              "filed-gstr3b-download-clicked",
              "filed-gstr3b-portal-blob-download-captured",
              "filed-gstr3b-extension-download-requested",
            ],
            scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
            state: "clicked" as const,
          },
        })),
        storageKeys: { completion: "completion", targetReview: "target-review" },
        timings: { targetBoundPortalDownloadWaitMs: 1_000 },
      },
      scope: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      tabId: 17,
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.local["target-review"]).toMatchObject({
      downloadAttempt: {
        downloadId: 81,
        phase: "target-bound-candidate-observing",
      },
    });
    expect(mocks.session.completion).toBeUndefined();
    await vi.advanceTimersByTimeAsync(950);
    const response = await responsePromise;

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        downloadDiagnostic: {
          downloadId: 81,
          downloadPathClass: "target-bound-portal-click-blob",
          endpointClass: "gstr3b-portal-rendered-download",
          mimeClass: "pdf",
          status: "downloaded",
        },
        state: "downloaded",
      },
      flowSummary: { completedPeriods: ["May"], status: "complete" },
    });
    expect(response.ok && "flowStep" in response ? response.flowStep.safeSignals : []).not.toEqual(
      expect.arrayContaining([
        "filed-gstr3b-portal-blob-download-captured",
        "filed-gstr3b-extension-download-requested",
      ]),
    );
    expect(mocks.events).toEqual([
      "storage:intent",
      "capture:clicked",
      "storage:candidate-id",
      "storage:exact-id",
      "storage:completion",
      "storage:review-cleared",
    ]);
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
    expect(mocks.local["target-review"]).toBeUndefined();
    expect(mocks.session.completion).toMatchObject({ status: "complete" });
    expect(mocks.createdListeners.size).toBe(0);
  });

  it("persists a provisional exact ID while MAIN-world execution is still unresolved", async () => {
    const item = syntheticDownloadItem(82);
    mocks.browser.downloads.search.mockImplementation(async (query?: { id: number }) =>
      query?.id === item.id ? [item] : [],
    );
    let resolveCapture!: (value: unknown[]) => void;
    let captureResolved = false;
    const pendingCapture = new Promise<unknown[]>((resolve) => {
      resolveCapture = (value) => {
        captureResolved = true;
        resolve(value);
      };
    });
    mocks.browser.scripting.executeScript.mockImplementationOnce(() => {
      for (const listener of mocks.createdListeners) listener(item);
      return pendingCapture;
    });

    const responsePromise = triggerAndObserveFiledReturnDownload(triggerArguments());
    await vi.advanceTimersByTimeAsync(50);

    expect(captureResolved).toBe(false);
    expect(mocks.local["target-review"]).toMatchObject({
      downloadAttempt: {
        downloadId: 82,
        phase: "target-bound-candidate-observing",
      },
    });
    expect(mocks.session.completion).toBeUndefined();

    resolveCapture([
      {
        result: {
          capturedDownloadRequest: null,
          safeFailureSignals: [
            "filed-gstr3b-main-world-capture-armed",
            "filed-gstr3b-target-bound-native-blob-click-delegated",
          ],
          targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
        },
      },
    ]);
    await vi.advanceTimersByTimeAsync(950);
    const response = await responsePromise;

    expect(response).toMatchObject({
      ok: true,
      flowStep: { state: "downloaded" },
      flowSummary: { status: "complete" },
    });
    expect(mocks.local["target-review"]).toBeUndefined();
  });

  it("demotes a matching candidate that started before the trusted native delegation", async () => {
    const item = syntheticDownloadItem(83);
    item.startTime = "2026-06-24T00:00:00.050Z";
    mocks.browser.downloads.search.mockImplementation(async (query?: { id: number }) =>
      query?.id === item.id ? [item] : [],
    );
    mocks.browser.scripting.executeScript.mockImplementationOnce(async () => {
      for (const listener of mocks.createdListeners) listener(item);
      return [
        {
          result: {
            capturedDownloadRequest: null,
            safeFailureSignals: [
              "filed-gstr3b-main-world-capture-armed",
              "filed-gstr3b-target-bound-native-blob-click-delegated",
            ],
            targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
          },
        },
      ];
    });

    const responsePromise = triggerAndObserveFiledReturnDownload(triggerArguments());
    await vi.advanceTimersByTimeAsync(1_000);
    const response = await responsePromise;

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: expect.arrayContaining([
          "browser-download-correlation-rejected",
          "filed-gstr3b-download-candidate-pre-delegation",
        ]),
      },
    });
    expect(response.ok && "flowStep" in response ? response.flowStep.state : null).not.toBe(
      "downloaded",
    );
    expect(mocks.local["target-review"]).toMatchObject({
      downloadAttempt: { phase: "download-intent-persisted" },
    });
    expect(
      (mocks.local["target-review"] as { downloadAttempt?: { downloadId?: number } })
        .downloadAttempt?.downloadId,
    ).toBeUndefined();
    expect(mocks.session.completion).toBeUndefined();
  });

  it("ignores a sole same-period browser download without this action's filename nonce", async () => {
    const unrelated = syntheticDownloadItem(84);
    unrelated.filename = "/synthetic/GSTR3B_052026.pdf";
    mocks.browser.downloads.search.mockImplementation(async (query?: { id: number }) =>
      query?.id === unrelated.id ? [unrelated] : [],
    );
    mocks.browser.scripting.executeScript.mockImplementationOnce(async () => {
      for (const listener of mocks.createdListeners) listener(unrelated);
      return [
        {
          result: {
            capturedDownloadRequest: null,
            safeFailureSignals: [
              "filed-gstr3b-main-world-capture-armed",
              "filed-gstr3b-target-bound-native-blob-click-delegated",
            ],
            targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
          },
        },
      ];
    });

    const responsePromise = triggerAndObserveFiledReturnDownload(triggerArguments());
    await vi.advanceTimersByTimeAsync(1_000);
    const response = await responsePromise;

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: expect.arrayContaining(["browser-download-not-observed"]),
      },
    });
    expect(response.ok && "flowStep" in response ? response.flowStep.state : null).not.toBe(
      "downloaded",
    );
    expect(mocks.local["target-review"]).toMatchObject({
      downloadAttempt: { phase: "download-intent-persisted" },
    });
    expect(mocks.local["target-review"]).not.toMatchObject({
      downloadAttempt: { downloadId: expect.any(Number) },
    });
    expect(mocks.session.completion).toBeUndefined();
  });

  it.each([
    "capture-control-not-found",
    "capture-control-ambiguous",
    "capture-control-not-actionable",
    "capture-control-artifact-mismatch",
    "capture-control-fingerprint-mismatch",
    "capture-target-binding-missing",
    "capture-target-binding-invalid",
    "capture-target-path-mismatch",
    "capture-target-evidence-conflict",
    "capture-target-identity-missing",
    "capture-target-identity-mismatch",
    "capture-control-click-threw",
    "capture-hook-install-failed",
  ])("never adopts a matching browser item after %s", async (terminalSuffix) => {
    const item = syntheticDownloadItem(91);
    mocks.browser.downloads.search.mockImplementation(async (query?: { id: number }) =>
      query?.id === item.id ? [item] : [],
    );
    mocks.browser.scripting.executeScript.mockImplementationOnce(async () => {
      for (const listener of mocks.createdListeners) listener(item);
      return [
        {
          result: {
            capturedDownloadRequest: null,
            safeFailureSignals: [
              "filed-gstr3b-main-world-capture-armed",
              `filed-gstr3b-${terminalSuffix}`,
            ],
          },
        },
      ];
    });

    const response = await triggerAndObserveFiledReturnDownload(triggerArguments());

    expect(response).toMatchObject({ ok: true, flowStep: { state: "blocked" } });
    expect(response.ok && "flowStep" in response ? response.flowStep.state : null).not.toBe(
      "downloaded",
    );
    expect(mocks.local["target-review"]).toMatchObject({
      downloadAttempt: { phase: "download-intent-persisted" },
    });
    expect(mocks.local["target-review"]).not.toMatchObject({
      downloadAttempt: { downloadId: expect.any(Number) },
    });
    expect(mocks.session.completion).toBeUndefined();
    expect(mocks.events).not.toEqual(expect.arrayContaining(["storage:exact-id"]));
    expect(mocks.createdListeners.size).toBe(0);
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
  });

  it("preserves target-bound provenance across an in-progress observation and restart", async () => {
    const item = syntheticDownloadItem(92);
    item.bytesReceived = 0;
    item.fileSize = -1;
    item.state = "in_progress";
    item.totalBytes = -1;
    mocks.browser.downloads.search.mockImplementation(async (query?: { id: number }) =>
      query?.id === item.id ? [item] : [],
    );
    mocks.browser.scripting.executeScript.mockImplementationOnce(async () => {
      for (const listener of mocks.createdListeners) listener(item);
      return [
        {
          result: {
            capturedDownloadRequest: null,
            safeFailureSignals: [
              "filed-gstr3b-main-world-capture-armed",
              "filed-gstr3b-unbound-create-object-url-ignored",
              "filed-gstr3b-target-bound-native-blob-click-delegated",
            ],
            targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
          },
        },
      ];
    });

    const responsePromise = triggerAndObserveFiledReturnDownload(triggerArguments());
    await vi.advanceTimersByTimeAsync(31_000);
    const response = await responsePromise;

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        downloadDiagnostic: {
          downloadId: 92,
          downloadPathClass: "target-bound-portal-click-blob",
          mimeClass: "pdf",
          status: "download-unconfirmed",
        },
        state: "download-unconfirmed",
      },
    });
    expect(mocks.local["target-review"]).toMatchObject({
      downloadAttempt: { downloadId: 92, phase: "download-observing" },
      downloadDiagnostic: {
        downloadId: 92,
        downloadPathClass: "target-bound-portal-click-blob",
      },
    });
    expect(mocks.session.completion).toBeUndefined();

    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
    const restarted = await readCurrentFiledReturnsFlowSummary({
      storageKeys: {
        activeRun: "active-run",
        completion: "completion",
        fullFiscalYearLedger: "full-year-ledger",
        targetReview: "target-review",
      },
      now: () => ARMED_AT,
    });
    expect(restarted).toMatchObject({
      flowStep: {
        downloadDiagnostic: {
          downloadId: 92,
          downloadPathClass: "target-bound-portal-click-blob",
        },
        safeSignals: expect.arrayContaining(["filed-returns-download-reconciliation-required"]),
      },
    });
  });

  it("demotes a provisional ID when a second exact candidate arrives later in the window", async () => {
    const first = syntheticDownloadItem(93);
    const second = syntheticDownloadItem(94);
    mocks.browser.downloads.search.mockImplementation(async (query?: { id: number }) => {
      if (query?.id === first.id) return [first];
      if (query?.id === second.id) return [second];
      return [];
    });
    mocks.browser.scripting.executeScript.mockImplementationOnce(async () => {
      for (const listener of mocks.createdListeners) listener(first);
      globalThis.setTimeout(() => {
        for (const listener of mocks.createdListeners) listener(second);
      }, 300);
      return [
        {
          result: {
            capturedDownloadRequest: null,
            safeFailureSignals: [
              "filed-gstr3b-main-world-capture-armed",
              "filed-gstr3b-target-bound-native-blob-click-delegated",
            ],
            targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
          },
        },
      ];
    });

    const responsePromise = triggerAndObserveFiledReturnDownload(triggerArguments());
    await vi.advanceTimersByTimeAsync(300);
    const response = await responsePromise;

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        safeSignals: expect.arrayContaining([
          "browser-download-correlation-rejected",
          "filed-gstr3b-download-candidate-ambiguous",
        ]),
      },
    });
    expect(response.ok && "flowStep" in response ? response.flowStep.state : null).not.toBe(
      "downloaded",
    );
    expect(mocks.local["target-review"]).toMatchObject({
      downloadAttempt: { phase: "download-intent-persisted" },
    });
    expect(
      (mocks.local["target-review"] as { downloadAttempt?: { downloadId?: number } })
        .downloadAttempt?.downloadId,
    ).toBeUndefined();
    expect(mocks.session.completion).toBeUndefined();
    expect(mocks.browser.downloads.download).not.toHaveBeenCalled();
  });
});

function triggerArguments(): Parameters<typeof triggerAndObserveFiledReturnDownload>[0] {
  return {
    activePeriod: "May",
    artifactType: "PDF",
    deps: {
      now: () => ARMED_AT,
      portalTabIncognito: false,
      sendMessageToTabWithInjection: vi.fn(async (_tabId, message) => ({
        ok: true as const,
        mainWorldCaptureRequest: {
          actionId: message.payload.actionId,
          controlAttribute: "data-pack-capture-action",
          controlId: "synthetic-gstr3b-pdf-control",
          maxBytes: 36 * 1024 * 1024,
          signalPrefix: "filed-gstr3b",
          targetBinding: {
            artifactType: "PDF" as const,
            controlTextDigest: "a".repeat(64),
            financialYear: "2026-27",
            pathnameDigest: "b".repeat(64),
            period: "May" as const,
            returnType: "GSTR-3B" as const,
          },
          timeoutMs: 30_000,
        },
        downloadTrigger: {
          connectorId: "gst" as const,
          safeMessage: "Synthetic capture prepared.",
          safeSignals: ["filed-return-download-clicked", "filed-gstr3b-download-clicked"],
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "clicked" as const,
        },
      })),
      storageKeys: { completion: "completion", targetReview: "target-review" },
      timings: { targetBoundPortalDownloadWaitMs: 1_000 },
    },
    scope: {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    },
    tabId: 17,
  };
}

function syntheticDownloadItem(id: number): DownloadCreatedItem {
  return {
    bytesReceived: 2048,
    danger: "safe",
    exists: true,
    fileSize: 2048,
    filename: `/synthetic/GSTR3B_052026_pack-${TARGET_FILENAME_NONCE}.pdf`,
    finalUrl: "blob:https://return.gst.gov.in/synthetic-final",
    id,
    incognito: false,
    mime: "application/pdf",
    referrer: "",
    startTime: "2026-06-24T00:00:00.250Z",
    state: "complete",
    totalBytes: 2048,
    url: "blob:https://return.gst.gov.in/synthetic-source",
  };
}

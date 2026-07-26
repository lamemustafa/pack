import { afterEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  scripting: {
    executeScript: vi.fn(),
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

import { capturePortalBlobDownloadInMainWorld } from "../../src/background/main-world-capture-executor";

const TARGET_ACTION_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_FILENAME_NONCE = "00000000000040008000000000000001";
const FIXED_CATEGORICAL_FAILURE_SUFFIXES = [
  "xhr-selection-closed-with-context",
  "xhr-selection-closed-without-context",
  "xhr-page-callback-bound-readystatechange",
  "xhr-page-callback-bound-load",
  "xhr-page-callback-bound-loadend",
  "unbound-create-object-url-no-open-selection",
  "unbound-create-object-url-selection-open-no-context",
  "unbound-create-object-url-selection-open-invalid-context",
  "unbound-create-object-url-selection-open-valid-inactive-context",
] as const;

describe("main-world capture executor", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps restoration headroom beyond the injected capture timeout", async () => {
    vi.useFakeTimers();
    browserMocks.scripting.executeScript.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                {
                  result: {
                    capturedDownloadRequest: {
                      actionId: "action-1",
                      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
                      safeSignals: [
                        "gstr2b-portal-blob-captured",
                        "gstr2b-native-blob-click-suppressed",
                        "gstr2b-main-world-capture",
                      ],
                    },
                    safeFailureSignals: [],
                  },
                },
              ]),
            6_000,
          );
        }),
    );

    const capture = capturePortalBlobDownloadInMainWorld(17, captureRequest());
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(capture).resolves.toMatchObject({
      capturedDownloadRequest: { actionId: "action-1" },
      safeFailureSignals: [],
    });
  });

  it.each([
    {
      name: "mismatched action identity",
      result: {
        capturedDownloadRequest: {
          actionId: "action-from-page",
          dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
          safeSignals: [
            "gstr2b-portal-blob-captured",
            "gstr2b-native-blob-click-suppressed",
            "gstr2b-main-world-capture",
          ],
        },
        safeFailureSignals: [],
      },
    },
    {
      name: "page-controlled success diagnostic",
      result: {
        capturedDownloadRequest: {
          actionId: "action-1",
          dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
          safeSignals: [
            "gstr2b-portal-blob-captured",
            "gstr2b-native-blob-click-suppressed",
            "page-controlled-sensitive-text",
          ],
        },
        safeFailureSignals: [],
      },
    },
    {
      name: "page-controlled failure diagnostic",
      result: {
        capturedDownloadRequest: null,
        safeFailureSignals: ["gstr2b-main-world-capture-armed", "page-controlled-sensitive-text"],
      },
    },
  ])("rejects $name before flow construction", async ({ result }) => {
    browserMocks.scripting.executeScript.mockResolvedValue([{ result }]);

    const outcome = await capturePortalBlobDownloadInMainWorld(17, captureRequest());

    expect(outcome).toEqual({
      capturedDownloadRequest: null,
      safeFailureSignals: ["gstr2b-main-world-capture-result-rejected"],
    });
    expect(JSON.stringify(outcome)).not.toContain("page-controlled-sensitive-text");
  });

  it.each([
    "main-world-capture-timeout",
    "capture-hook-install-failed",
    "capture-control-artifact-mismatch",
    "capture-target-evidence-conflict",
    "capture-target-identity-missing",
  ])("accepts the trusted %s terminal failure signal", async (terminalSignal) => {
    browserMocks.scripting.executeScript.mockResolvedValue([
      {
        result: {
          capturedDownloadRequest: null,
          safeFailureSignals: ["gstr2b-main-world-capture-armed", `gstr2b-${terminalSignal}`],
        },
      },
    ]);

    await expect(capturePortalBlobDownloadInMainWorld(17, captureRequest())).resolves.toEqual({
      capturedDownloadRequest: null,
      safeFailureSignals: ["gstr2b-main-world-capture-armed", `gstr2b-${terminalSignal}`],
    });
  });

  it.each(FIXED_CATEGORICAL_FAILURE_SUFFIXES)(
    "accepts the fixed %s diagnostic with a trusted terminal failure",
    async (diagnosticSuffix) => {
      const safeFailureSignals = [
        "gstr2b-main-world-capture-armed",
        `gstr2b-${diagnosticSuffix}`,
        "gstr2b-main-world-capture-timeout",
      ];
      browserMocks.scripting.executeScript.mockResolvedValue([
        { result: { capturedDownloadRequest: null, safeFailureSignals } },
      ]);

      await expect(capturePortalBlobDownloadInMainWorld(17, captureRequest())).resolves.toEqual({
        capturedDownloadRequest: null,
        safeFailureSignals,
      });
    },
  );

  it.each(FIXED_CATEGORICAL_FAILURE_SUFFIXES)(
    "rejects the non-terminal %s diagnostic without a trusted terminal failure",
    async (diagnosticSuffix) => {
      browserMocks.scripting.executeScript.mockResolvedValue([
        {
          result: {
            capturedDownloadRequest: null,
            safeFailureSignals: ["gstr2b-main-world-capture-armed", `gstr2b-${diagnosticSuffix}`],
          },
        },
      ]);

      await expect(capturePortalBlobDownloadInMainWorld(17, captureRequest())).resolves.toEqual({
        capturedDownloadRequest: null,
        safeFailureSignals: ["gstr2b-main-world-capture-result-rejected"],
      });
    },
  );

  it.each([
    "xhr-page-callback-bound-progress",
    "xhr-page-callback-bound-load-12345",
    "unbound-create-object-url-selection-open-valid-inactive-context-sensitive-value",
  ])("rejects the untrusted %s diagnostic even with a trusted terminal failure", async (suffix) => {
    browserMocks.scripting.executeScript.mockResolvedValue([
      {
        result: {
          capturedDownloadRequest: null,
          safeFailureSignals: [
            "gstr2b-main-world-capture-armed",
            `gstr2b-${suffix}`,
            "gstr2b-main-world-capture-timeout",
          ],
        },
      },
    ]);

    const outcome = await capturePortalBlobDownloadInMainWorld(17, captureRequest());

    expect(outcome).toEqual({
      capturedDownloadRequest: null,
      safeFailureSignals: ["gstr2b-main-world-capture-result-rejected"],
    });
    expect(JSON.stringify(outcome)).not.toContain(suffix);
  });

  it("accepts the native delegation terminal only for a GSTR-3B PDF target", async () => {
    const request = targetBoundCaptureRequest();
    browserMocks.scripting.executeScript.mockResolvedValue([
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

    await expect(capturePortalBlobDownloadInMainWorld(17, request)).resolves.toEqual({
      capturedDownloadRequest: null,
      safeFailureSignals: [
        "filed-gstr3b-main-world-capture-armed",
        "filed-gstr3b-target-bound-native-blob-click-delegated",
      ],
      targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
    });
  });

  it("rejects native delegation evidence for every other target", async () => {
    browserMocks.scripting.executeScript.mockResolvedValue([
      {
        result: {
          capturedDownloadRequest: null,
          safeFailureSignals: [
            "gstr2b-main-world-capture-armed",
            "gstr2b-target-bound-native-blob-click-delegated",
          ],
          targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
        },
      },
    ]);

    await expect(capturePortalBlobDownloadInMainWorld(17, captureRequest())).resolves.toEqual({
      capturedDownloadRequest: null,
      safeFailureSignals: ["gstr2b-main-world-capture-result-rejected"],
    });
  });

  it.each([
    {
      name: "delegation signal without its timestamp",
      result: {
        capturedDownloadRequest: null,
        safeFailureSignals: [
          "filed-gstr3b-main-world-capture-armed",
          "filed-gstr3b-target-bound-native-blob-click-delegated",
        ],
      },
    },
    {
      name: "delegation timestamp without its signal",
      result: {
        capturedDownloadRequest: null,
        safeFailureSignals: [
          "filed-gstr3b-main-world-capture-armed",
          "filed-gstr3b-main-world-capture-timeout",
        ],
        targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
      },
    },
  ])("rejects $name", async ({ result }) => {
    const request = targetBoundCaptureRequest();
    browserMocks.scripting.executeScript.mockResolvedValue([{ result }]);

    await expect(capturePortalBlobDownloadInMainWorld(17, request)).resolves.toEqual({
      capturedDownloadRequest: null,
      safeFailureSignals: ["filed-gstr3b-main-world-capture-result-rejected"],
    });
  });

  it("rejects a valid-shaped filename nonce that belongs to another action", async () => {
    const request = {
      ...targetBoundCaptureRequest(),
      targetBoundNativeFilenameNonce: "11111111111141118111111111111111",
    };
    browserMocks.scripting.executeScript.mockResolvedValue([
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

    await expect(capturePortalBlobDownloadInMainWorld(17, request)).resolves.toEqual({
      capturedDownloadRequest: null,
      safeFailureSignals: ["filed-gstr3b-main-world-capture-result-rejected"],
    });
  });
});

function targetBoundCaptureRequest() {
  const baseRequest = captureRequest();
  return {
    ...baseRequest,
    actionId: TARGET_ACTION_ID,
    signalPrefix: "filed-gstr3b",
    targetBoundNativeFilenameNonce: TARGET_FILENAME_NONCE,
    targetBinding: { ...baseRequest.targetBinding, returnType: "GSTR-3B" as const },
  };
}

function captureRequest() {
  return {
    actionId: "action-1",
    controlAttribute: "data-pack-gstr2b-capture-action",
    controlId: "capture-1",
    maxBytes: 36 * 1024 * 1024,
    signalPrefix: "gstr2b",
    targetBinding: {
      artifactType: "PDF" as const,
      controlTextDigest: "1234abcd",
      financialYear: "2026-27",
      pathnameDigest: "abcd1234",
      period: "May" as const,
      returnType: "GSTR-2B" as const,
    },
    timeoutMs: 5_000,
  };
}

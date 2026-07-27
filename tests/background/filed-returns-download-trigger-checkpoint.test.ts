import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARTIFACT_FAILURE_MESSAGES } from "../../src/connectors/gst/artifact-source";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";
import { artifactAcquisitionCheckpointKey } from "../../src/background/artifact-acquisition-state";

const mocks = vi.hoisted(() => {
  const session: Record<string, unknown> = {};
  return {
    acquireGstr3bPdfAfterPreflight: vi.fn(),
    downloadAcquiredArtifact: vi.fn(),
    session,
    browser: {
      downloads: { search: vi.fn() },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: session[key] })),
          remove: vi.fn(async (key: string) => delete session[key]),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(session, values)),
        },
      },
    },
  };
});

vi.mock("wxt/browser", () => ({ browser: mocks.browser }));
vi.mock("../../src/background/artifact-download", () => ({
  downloadAcquiredArtifact: mocks.downloadAcquiredArtifact,
}));
vi.mock("../../src/background/gstr3b-artifact-acquisition", () => ({
  acquireGstr3bPdfAfterPreflight: mocks.acquireGstr3bPdfAfterPreflight,
}));

import { triggerAndObserveFiledReturnDownload } from "../../src/background/filed-returns-download-trigger";

const scope = {
  artifactType: "PDF" as const,
  financialYear: "2025-26",
  period: "May",
  returnType: "GSTR-3B" as const,
};

describe("GSTR-3B artifact acquisition checkpoint cleanup", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
    vi.clearAllMocks();
  });

  it.each(Object.keys(ARTIFACT_FAILURE_MESSAGES))(
    "leaves checkpoint storage empty after terminal %s acquisition failure",
    async (reason) => {
      const response = await triggerAndObserveFiledReturnDownload({
        activePeriod: "May",
        artifactType: "PDF",
        deps: {
          sendMessageToTabWithInjection: vi.fn(async () => artifactFailure(reason)),
          storageKeys: {},
        },
        scope,
        tabId: 17,
      });

      expect(response).toMatchObject({ flowStep: { state: "blocked" } });
      expect(mocks.session).toEqual({});
    },
  );

  it.each(["start-rejected", "interrupted", "empty"] as const)(
    "clears the JSON checkpoint after terminal %s delivery failure",
    async (reason) => {
      mocks.downloadAcquiredArtifact.mockImplementationOnce(async (input) => {
        await input.onStarted?.(91);
        return { ok: false, reason, safeSignals: [] };
      });
      const response = await triggerAndObserveFiledReturnDownload({
        activePeriod: "May",
        artifactType: "JSON",
        deps: {
          sendMessageToTabWithInjection: vi.fn(async () => acquiredJson()),
          storageKeys: {},
        },
        scope: { ...scope, artifactType: "JSON" },
        tabId: 17,
      });

      expect(response).toMatchObject({ flowStep: { state: "blocked" } });
      expect(mocks.session).toEqual({});
    },
  );

  it("retains the JSON checkpoint when Pack times out before the download outcome is known", async () => {
    mocks.downloadAcquiredArtifact.mockImplementationOnce(async (input) => {
      await input.onStarted?.(91);
      return { ok: false, reason: "timeout", safeSignals: [] };
    });
    const target = { ...scope, artifactType: "JSON" as const };
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "May",
      artifactType: "JSON",
      deps: {
        sendMessageToTabWithInjection: vi.fn(async () => acquiredJson()),
        storageKeys: {},
      },
      scope: target,
      tabId: 17,
    });

    expect(response).toMatchObject({ flowStep: { state: "blocked" } });
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toEqual(
      expect.objectContaining({ downloadId: 91 }),
    );
  });

  it("retains the JSON checkpoint for review after its download ID checkpoint fails", async () => {
    mocks.downloadAcquiredArtifact.mockImplementationOnce(async (input) => {
      await input.onStartCheckpointFailed?.(91);
      return { ok: false, reason: "checkpoint-failed", safeSignals: [] };
    });
    const target = { ...scope, artifactType: "JSON" as const };

    await triggerAndObserveFiledReturnDownload({
      activePeriod: "May",
      artifactType: "JSON",
      deps: {
        sendMessageToTabWithInjection: vi.fn(async () => acquiredJson()),
        storageKeys: {},
      },
      scope: target,
      tabId: 17,
    });

    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toEqual(
      expect.objectContaining({ downloadId: 91, state: "download-unconfirmed" }),
    );
  });

  it.each(Object.keys(ARTIFACT_FAILURE_MESSAGES))(
    "clears the PDF checkpoint after terminal %s acquisition failure",
    async (reason) => {
      mocks.acquireGstr3bPdfAfterPreflight.mockImplementationOnce(async (input) => {
        await input.onStarted?.(92);
        return { ok: false, reason, safeSignals: [] };
      });
      const response = await triggerAndObserveFiledReturnDownload({
        activePeriod: "May",
        artifactType: "PDF",
        deps: {
          sendMessageToTabWithInjection: vi.fn(async () => preparedPdf()),
          storageKeys: {},
        },
        scope,
        tabId: 17,
      });

      expect(response).toMatchObject({ flowStep: { state: "blocked" } });
      expect(mocks.session).toEqual({});
    },
  );

  it("retains the PDF checkpoint when Pack times out before the download outcome is known", async () => {
    mocks.acquireGstr3bPdfAfterPreflight.mockImplementationOnce(async (input) => {
      await input.onStarted?.(92);
      return { ok: false, reason: "timeout", safeSignals: [] };
    });
    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod: "May",
      artifactType: "PDF",
      deps: {
        sendMessageToTabWithInjection: vi.fn(async () => preparedPdf()),
        storageKeys: {},
      },
      scope,
      tabId: 17,
    });

    expect(response).toMatchObject({ flowStep: { state: "blocked" } });
    expect(mocks.session[artifactAcquisitionCheckpointKey(scope)]).toEqual(
      expect.objectContaining({ downloadId: 92 }),
    );
  });

  it("retains the PDF checkpoint for review after its download ID checkpoint fails", async () => {
    mocks.acquireGstr3bPdfAfterPreflight.mockImplementationOnce(async (input) => {
      await input.onStartCheckpointFailed?.(92);
      return { ok: false, reason: "checkpoint-failed", safeSignals: [] };
    });

    await triggerAndObserveFiledReturnDownload({
      activePeriod: "May",
      artifactType: "PDF",
      deps: {
        sendMessageToTabWithInjection: vi.fn(async () => preparedPdf()),
        storageKeys: {},
      },
      scope,
      tabId: 17,
    });

    expect(mocks.session[artifactAcquisitionCheckpointKey(scope)]).toEqual(
      expect.objectContaining({ downloadId: 92, state: "download-unconfirmed" }),
    );
  });
});

function artifactFailure(reason: string): PackMessageResponse {
  return {
    ok: true,
    artifact: {
      ok: false,
      reason: reason as keyof typeof ARTIFACT_FAILURE_MESSAGES,
      requestId: "synthetic-request",
      safeSignals: [],
    },
  };
}

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

function preparedPdf(): PackMessageResponse {
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

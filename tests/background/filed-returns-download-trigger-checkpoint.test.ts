import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARTIFACT_FAILURE_MESSAGES } from "../../src/connectors/gst/artifact-source";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";
import { artifactAcquisitionCheckpointKey } from "../../src/background/artifact-acquisition-state";

const mocks = vi.hoisted(() => {
  const session: Record<string, unknown> = {};
  return {
    acquireGstr3bPdfAfterPreflight: vi.fn(),
    acquireFiledReturnJsonInMainWorld: vi.fn(async (input) =>
      mocks.downloadAcquiredArtifact(input),
    ),
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
vi.mock("../../src/background/filed-returns-json-acquisition", () => ({
  acquireFiledReturnJsonInMainWorld: mocks.acquireFiledReturnJsonInMainWorld,
}));

import { triggerAndObserveFiledReturnDownload } from "../../src/background/filed-returns-download-trigger";

const scope = {
  artifactType: "PDF" as const,
  financialYear: "2025-26",
  period: "May",
  returnType: "GSTR-3B" as const,
};

const RETAINED_TERMINAL_DELIVERY_FAILURES = [
  "danger-unconfirmed",
  "danger-rejected",
  "empty",
  "delivery-unconfirmed",
  "generation-timeout",
  "main-world-execution-failed",
  "interrupted",
  "search-unavailable",
] as const;

describe("GSTR-3B artifact acquisition checkpoint cleanup", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
    vi.clearAllMocks();
    mocks.browser.storage.session.set.mockImplementation(
      async (values: Record<string, unknown>) => {
        return Object.assign(mocks.session, values);
      },
    );
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

  it("clears the JSON checkpoint when the browser rejects its start", async () => {
    mocks.downloadAcquiredArtifact.mockImplementationOnce(async () => ({
      ok: false,
      reason: "start-rejected",
      safeSignals: [],
    }));
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
  });

  it("clears the JSON checkpoint when MAIN-world execution fails before any browser action", async () => {
    mocks.acquireFiledReturnJsonInMainWorld.mockResolvedValueOnce({
      ok: false,
      reason: "main-world-execution-failed",
      safeSignals: [],
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
  });

  it.each(["interrupted", "empty"] as const)(
    "retains the JSON checkpoint after terminal %s delivery failure with an exact ID",
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
      expect(
        mocks.session[artifactAcquisitionCheckpointKey({ ...scope, artifactType: "JSON" })],
      ).toEqual(expect.objectContaining({ downloadId: 91, state: "download-observing" }));
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

  it("retains the exact JSON download ID when both checkpoint writes report rejection after committing", async () => {
    let checkpointWrites = 0;
    mocks.browser.storage.session.set.mockImplementation(
      async (values: Record<string, unknown>) => {
        const stored = Object.assign(mocks.session, values);
        checkpointWrites += 1;
        if (checkpointWrites > 1) throw new Error("synthetic checkpoint storage rejection");
        return stored;
      },
    );
    mocks.downloadAcquiredArtifact.mockImplementationOnce(async (input) => {
      try {
        await input.onStarted?.(91);
      } catch {
        try {
          await input.onStartCheckpointFailed?.(91);
        } catch {
          // A response may reject after Chrome persisted the exact ID.
        }
      }
      return { ok: false, reason: "checkpoint-failed", safeSignals: [] };
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

    expect(response).toMatchObject({
      flowStep: { safeMessage: expect.any(String), state: "blocked" },
    });
    expect(mocks.session[artifactAcquisitionCheckpointKey(target)]).toEqual(
      expect.objectContaining({ downloadId: 91, state: "download-unconfirmed" }),
    );
  });

  it("retains the JSON intent when neither checkpoint write commits", async () => {
    let checkpointWrites = 0;
    mocks.browser.storage.session.set.mockImplementation(
      async (values: Record<string, unknown>) => {
        checkpointWrites += 1;
        if (checkpointWrites > 1) throw new Error("synthetic checkpoint storage rejection");
        return Object.assign(mocks.session, values);
      },
    );
    mocks.downloadAcquiredArtifact.mockImplementationOnce(async (input) => {
      try {
        await input.onStarted?.(91);
      } catch {
        await input.onStartCheckpointFailed?.(91).catch(() => undefined);
      }
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
      expect.objectContaining({ state: "intent" }),
    );
  });

  it("renders a blocked user-visible result for an unconfirmed direct JSON delivery", async () => {
    mocks.acquireFiledReturnJsonInMainWorld.mockResolvedValueOnce({
      ok: false,
      reason: "delivery-unconfirmed",
      safeSignals: [],
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

    expect(response).toMatchObject({
      flowStep: { safeMessage: expect.any(String), state: "blocked" },
    });
  });

  it("retains the page-generated PDF intent when MAIN-world execution cannot be proven", async () => {
    mocks.acquireGstr3bPdfAfterPreflight.mockResolvedValueOnce({
      ok: false,
      reason: "main-world-execution-failed",
      safeSignals: [],
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
      expect.objectContaining({ state: "intent" }),
    );
  });

  it.each(
    Object.keys(ARTIFACT_FAILURE_MESSAGES).filter(
      (reason) => !RETAINED_TERMINAL_DELIVERY_FAILURES.includes(reason as never),
    ),
  )("clears the PDF checkpoint after terminal %s acquisition failure", async (reason) => {
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
  });

  it.each(["danger-unconfirmed", "danger-rejected"] as const)(
    "retains the JSON checkpoint after a completed browser download is %s",
    async (reason) => {
      mocks.downloadAcquiredArtifact.mockImplementationOnce(async (input) => {
        await input.onStarted?.(91);
        return { ok: false, reason, safeSignals: [] };
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
        expect.objectContaining({ downloadId: 91, state: "download-observing" }),
      );
    },
  );

  it("retains the GSTR-2B direct-artifact checkpoint after an unconfirmed browser download", async () => {
    mocks.downloadAcquiredArtifact.mockImplementationOnce(async (input) => {
      await input.onStarted?.(93);
      return { ok: false, reason: "danger-unconfirmed", safeSignals: [] };
    });
    const target = { ...scope, artifactType: "JSON" as const, returnType: "GSTR-2B" as const };

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
      expect.objectContaining({ downloadId: 93, state: "download-observing" }),
    );
  });

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
      state: "ready",
      requestId: "synthetic-request",
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

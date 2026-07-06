import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runDownloadStepWithRetry,
  runDownloadTriggerOnce,
  type FiledReturnsFlowMessagingDeps,
} from "../../src/background/filed-returns-flow-messaging";
import type { FiledReturnsDownloadTarget } from "../../src/core/contracts";
import type { PackMessageResponse } from "../../src/core/messages";

const BASE_DEPS = {
  storageKeys: {},
  timings: { contentMessageTimeoutMs: 25 },
} satisfies Pick<FiledReturnsFlowMessagingDeps, "storageKeys" | "timings">;

describe("filed returns flow messaging", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns content unavailable when a content step message never resolves", async () => {
    vi.useFakeTimers();
    const deps: FiledReturnsFlowMessagingDeps = {
      ...BASE_DEPS,
      sendMessageToTabWithInjection: vi.fn(() => new Promise<never>(() => undefined)),
    };

    const responsePromise = runDownloadStepWithRetry(deps, 10, {
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      payload: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(responsePromise).resolves.toEqual({
      ok: false,
      error: "CONTENT_SCRIPT_UNAVAILABLE",
    });
    expect(deps.sendMessageToTabWithInjection).toHaveBeenCalledTimes(1);
  });

  it("keeps default content steps alive past the dropdown convergence budget", async () => {
    vi.useFakeTimers();
    const deps: FiledReturnsFlowMessagingDeps = {
      storageKeys: {},
      sendMessageToTabWithInjection: vi.fn(
        () =>
          new Promise<PackMessageResponse>((resolve) => {
            globalThis.setTimeout(
              () =>
                resolve({
                  ok: true,
                  flowStep: {
                    connectorId: "gst",
                    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
                    state: "clicked",
                    safeSignals: ["content-step-complete"],
                    safeMessage: "Content step completed.",
                  },
                }),
              45_000,
            );
          }),
      ),
    };

    const responsePromise = runDownloadStepWithRetry(deps, 10, {
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      payload: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
    });

    await vi.advanceTimersByTimeAsync(45_000);

    await expect(responsePromise).resolves.toMatchObject({
      ok: true,
      flowStep: { state: "clicked" },
    });
    expect(deps.sendMessageToTabWithInjection).toHaveBeenCalledTimes(1);
  });

  it("uses ambiguous download recovery when a trigger message never resolves", async () => {
    vi.useFakeTimers();
    const deps: FiledReturnsFlowMessagingDeps = {
      ...BASE_DEPS,
      sendMessageToTabWithInjection: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const target: FiledReturnsDownloadTarget = {
      actionId: "view",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    };

    const responsePromise = runDownloadTriggerOnce(deps, 10, target);

    await vi.advanceTimersByTimeAsync(25);

    await expect(responsePromise).resolves.toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-gstr3b-download-trigger-ambiguous"]),
      },
    });
    expect(deps.sendMessageToTabWithInjection).toHaveBeenCalledTimes(1);
  });
});

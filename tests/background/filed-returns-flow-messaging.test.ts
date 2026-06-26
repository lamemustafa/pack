import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runDownloadStepWithRetry,
  runDownloadTriggerOnce,
  type FiledReturnsFlowMessagingDeps,
} from "../../src/background/filed-returns-flow-messaging";
import type { FiledReturnsDownloadTarget } from "../../src/core/contracts";

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
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
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

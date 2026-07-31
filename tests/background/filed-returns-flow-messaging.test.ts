import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runDownloadStepWithRetry,
  runDownloadTriggerOnce,
  type FiledReturnsFlowMessagingDeps,
} from "../../src/background/filed-returns-flow-messaging";
import type { FiledReturnsDownloadTarget } from "../../src/connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";

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
      safeMessage:
        "Pack could not safely reach the GST tab. Reload the GST Portal tab, then try again.",
    });
    expect(deps.sendMessageToTabWithInjection).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    null,
    "",
    0,
    {},
    { ok: true },
    { ok: true, flowStep: null },
    { ok: false, error: "raw content-script exception detail" },
    {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "invented-state",
        safeSignals: [],
        safeMessage: "Invalid state.",
      },
    },
    {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "ready",
        safeSignals: [],
        safeMessage: "Wrong return scope.",
      },
    },
    {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "ready",
        safeSignals: ["unsafe signal with spaces"],
        safeMessage: "Malformed signal.",
      },
    },
    {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "ready",
        safeSignals: [],
      },
    },
    {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "ready",
        safeSignals: [],
        safeMessage: "x".repeat(501),
      },
    },
  ])(
    "renders content unavailable when a content step responds with %p",
    async (invalidResponse) => {
      const deps: FiledReturnsFlowMessagingDeps = {
        ...BASE_DEPS,
        sendMessageToTabWithInjection: vi.fn(
          async () => invalidResponse as unknown as PackMessageResponse,
        ),
      };

      await expect(
        runDownloadStepWithRetry(deps, 10, {
          type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
          payload: {
            financialYear: "2026-27",
            period: "April",
            returnType: "GSTR-1",
            artifactType: "PDF",
          },
        }),
      ).resolves.toEqual({
        ok: false,
        error: "CONTENT_SCRIPT_UNAVAILABLE",
        safeMessage:
          "The GST tab responded to Pack without a usable result. Reload the GST Portal tab, then try again.",
      });
      expect(deps.sendMessageToTabWithInjection).toHaveBeenCalledTimes(1);
    },
  );

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

  it("accepts the token-safe GSTR-2B selected-quarter diagnostic", async () => {
    const deps: FiledReturnsFlowMessagingDeps = {
      ...BASE_DEPS,
      sendMessageToTabWithInjection: vi.fn(
        async () =>
          ({
            ok: true,
            flowStep: {
              connectorId: "gst",
              scopeId: "gst-gstr2b-private-v0",
              state: "clicked",
              safeSignals: ["gstr2b-dashboard-selected-quarter:quarter-1-apr-jun"],
              safeMessage: "Pack selected the requested GSTR-2B quarter.",
            },
          }) satisfies PackMessageResponse,
      ),
    };

    await expect(
      runDownloadStepWithRetry(deps, 10, {
        type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
        payload: {
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-2B",
        },
      }),
    ).resolves.toMatchObject({ ok: true, flowStep: { state: "clicked" } });
  });

  it("accepts the live GSTR-2B dashboard response with repeated filter snapshots", async () => {
    const response = {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "clicked",
        safeSignals: [
          "gstr2b-return-dashboard-route",
          "gstr2b-dashboard-root-found",
          "gstr2b-dashboard-year-select-found",
          "gstr2b-dashboard-quarter-select-found",
          "gstr2b-dashboard-period-select-found",
          "gstr2b-dashboard-search-found",
          "gstr2b-dashboard-selected-year:2026-27",
          "gstr2b-dashboard-selected-quarter:quarter-1-apr-jun",
          "gstr2b-dashboard-selected-period:june",
          "gstr2b-return-dashboard-filter-selection-in-progress",
          "period-selected",
          "gstr2b-dashboard-selected-year:2026-27",
          "gstr2b-dashboard-selected-quarter:quarter-1-apr-jun",
          "gstr2b-dashboard-selected-period:april",
        ],
        safeMessage:
          "Pack selected part of the GSTR-2B return dashboard filters and is waiting for the GST portal to finish updating them.",
      },
    } satisfies PackMessageResponse;
    const deps: FiledReturnsFlowMessagingDeps = {
      ...BASE_DEPS,
      sendMessageToTabWithInjection: vi.fn(async () => response),
    };

    await expect(
      runDownloadStepWithRetry(deps, 10, {
        type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
        payload: {
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-2B",
          artifactType: "PDF_AND_EXCEL",
        },
      }),
    ).resolves.toEqual(response);
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

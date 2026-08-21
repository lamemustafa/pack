import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackMessage } from "../../src/connectors/gst/messages";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  changeListeners: new Set<
    (changes: Record<string, Browser.storage.StorageChange>, areaName: string) => void
  >(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { sendMessage: mocks.sendMessage },
    storage: {
      onChanged: {
        addListener: (
          listener: (
            changes: Record<string, Browser.storage.StorageChange>,
            areaName: string,
          ) => void,
        ) => mocks.changeListeners.add(listener),
        removeListener: (
          listener: (
            changes: Record<string, Browser.storage.StorageChange>,
            areaName: string,
          ) => void,
        ) => mocks.changeListeners.delete(listener),
      },
    },
  },
}));

import { usePackPopupController } from "../../src/entrypoints/popup/use-pack-popup-controller";

let controller: ReturnType<typeof usePackPopupController> | null = null;
let root: Root | null = null;

function Harness({
  onChange,
}: {
  onChange: (next: ReturnType<typeof usePackPopupController>) => void;
}) {
  const next = usePackPopupController();
  React.useEffect(() => {
    onChange(next);
  }, [next, onChange]);
  return null;
}

describe("popup background failure presentation", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.changeListeners.clear();
    controller = null;
    const dom = new JSDOM("<div id='root'></div>", { url: "https://extension.test" });
    Object.assign(globalThis, { document: dom.window.document, window: dom.window });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.sendMessage.mockImplementation((message: PackMessage) => {
      if (message.type === "PACK_GET_CONTEXT") {
        return Promise.resolve({
          ok: true,
          context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
        });
      }
      return Promise.resolve({ ok: true });
    });
    root = createRoot(dom.window.document.getElementById("root") as Element);
    await act(async () => {
      root?.render(<Harness onChange={(next) => (controller = next)} />);
      await Promise.resolve();
    });
  });

  it("keeps a flow failure when a later context refresh succeeds", async () => {
    mocks.sendMessage.mockImplementation((message: PackMessage) =>
      message.type === "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW"
        ? Promise.reject(new Error("worker unavailable"))
        : Promise.resolve({
            ok: true,
            context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
          }),
    );

    await act(async () => {
      await controller?.startFiledReturnsFlow();
    });
    expect(controller?.actionError).toBe(
      "Pack could not reach the background service. Try the action again.",
    );

    // A successful context refresh must not clear a failure it did not cause.
    await act(async () => {
      await controller?.refreshPortalContext();
    });

    expect(controller?.actionError).toBe(
      "Pack could not reach the background service. Try the action again.",
    );
    await act(async () => root?.unmount());
  });

  it("renders a safe action error when the background message rejects", async () => {
    mocks.sendMessage.mockImplementation((message: PackMessage) =>
      message.type === "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW"
        ? Promise.reject(new Error("worker unavailable"))
        : Promise.resolve({ ok: true }),
    );

    await act(async () => {
      await controller?.startFiledReturnsFlow();
    });

    expect(controller?.actionError).toBe(
      "Pack could not reach the background service. Try the action again.",
    );
    await act(async () => root?.unmount());
  });

  it("refreshes the visible summary when durable ZIP reconciliation completes", async () => {
    const completedSummary = {
      scope: {
        artifactType: "PDF" as const,
        financialYear: "2026-27",
        period: "FULL_FISCAL_YEAR" as const,
        returnType: "GSTR-3B" as const,
      },
      status: "complete" as const,
      completedPeriods: ["April"],
      currentPeriod: "April" as const,
      totalPeriods: 12,
      updatedAt: "2026-07-26T00:00:00.000Z",
      flowStep: {
        connectorId: "gst" as const,
        scopeId: "gst-gstr3b-private-v0",
        state: "downloaded" as const,
        safeSignals: ["browser-download-completed"],
        safeMessage: "Pack confirmed the final ZIP download.",
      },
    };
    mocks.sendMessage.mockImplementation((message: PackMessage) => {
      if (message.type === "PACK_GET_CONTEXT") {
        return Promise.resolve({
          ok: true,
          context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
        });
      }
      if (message.type === "PACK_GET_FILED_RETURNS_FLOW_SUMMARY") {
        return Promise.resolve({ ok: true, flowSummary: completedSummary });
      }
      return Promise.resolve({ ok: true });
    });
    expect(mocks.changeListeners.size).toBe(1);

    await act(async () => {
      mocks.changeListeners.forEach((listener) =>
        listener(
          { "pack:last-filed-returns-flow-summary": { newValue: completedSummary } },
          "session",
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY",
      }),
    );
    await vi.waitFor(() => expect(controller?.lastRunSummary).toEqual(completedSummary));

    // Clearing local data removes the key, so the change carries no newValue.
    // A surface that stays open must stop rendering the summary that no longer
    // exists; the short-lived popup hid this, the panel page does not.
    mocks.sendMessage.mockImplementation((message: PackMessage) => {
      if (message.type === "PACK_GET_CONTEXT") {
        return Promise.resolve({
          ok: true,
          context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
        });
      }
      if (message.type === "PACK_GET_FILED_RETURNS_FLOW_SUMMARY") {
        return Promise.resolve({ ok: true, flowSummary: null });
      }
      return Promise.resolve({ ok: true });
    });
    const chosenScope = controller?.scope;

    await act(async () => {
      mocks.changeListeners.forEach((listener) =>
        listener(
          { "pack:last-filed-returns-flow-summary": { oldValue: completedSummary } },
          "session",
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(controller?.lastRunSummary).toBeNull());
    // The scope is the user's own selection and must survive a clear.
    expect(controller?.scope).toEqual(chosenScope);
    await act(async () => root?.unmount());
  });
});

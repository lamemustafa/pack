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

  it("keeps a flow failure that replaced an earlier context failure", async () => {
    // A context refresh fails FIRST and marks the error as its own, then a flow
    // action fails and replaces the message. A boolean the context path alone
    // maintained stayed set, so the next successful refresh cleared a flow error
    // it did not own and hid a live diagnostic.
    let contextFails = true;
    mocks.sendMessage.mockImplementation((message: PackMessage) => {
      if (message.type === "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW") {
        return Promise.reject(new Error("worker unavailable"));
      }
      return contextFails
        ? Promise.reject(new Error("context unavailable"))
        : Promise.resolve({
            ok: true,
            context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
          });
    });

    await act(async () => {
      await controller?.refreshPortalContext();
    });
    expect(controller?.actionError).toBe(
      "Pack could not read the current GST Portal state. Try again.",
    );

    await act(async () => {
      await controller?.startFiledReturnsFlow();
    });
    const flowFailure = "Pack could not reach the background service. Try the action again.";
    expect(controller?.actionError).toBe(flowFailure);

    contextFails = false;
    await act(async () => {
      await controller?.refreshPortalContext();
    });

    expect(controller?.actionError).toBe(flowFailure);
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

  it("keeps a flow action's specific safe rejection visible", async () => {
    mocks.sendMessage.mockImplementation((message: PackMessage) => {
      if (message.type === "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW") {
        return Promise.resolve({
          ok: false,
          error: "BACKGROUND_MESSAGE_HANDLER_FAILED",
          safeMessage: "Pack needs a saved-run check before continuing.",
        });
      }
      if (message.type === "PACK_GET_CONTEXT") {
        return Promise.resolve({
          ok: true,
          context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
        });
      }
      return Promise.resolve({ ok: true, flowSummary: null });
    });

    await act(async () => {
      await controller?.startFiledReturnsFlow();
    });

    expect(controller?.actionError).toBe("Pack needs a saved-run check before continuing.");
    await act(async () => root?.unmount());
  });

  it("keeps an interrupted-run acknowledgement's specific safe rejection visible", async () => {
    mocks.sendMessage.mockImplementation((message: PackMessage) => {
      if (message.type === "PACK_ACKNOWLEDGE_INTERRUPTED_RUN") {
        return Promise.resolve({
          ok: false,
          error: "BACKGROUND_MESSAGE_HANDLER_FAILED",
          safeMessage: "Pack could not clear the saved run until its local state is checked.",
        });
      }
      if (message.type === "PACK_GET_CONTEXT") {
        return Promise.resolve({
          ok: true,
          context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
        });
      }
      return Promise.resolve({ ok: true, flowSummary: null });
    });

    await act(async () => {
      await controller?.acknowledgeInterruptedRun();
    });

    expect(controller?.actionError).toBe(
      "Pack could not clear the saved run until its local state is checked.",
    );
    await act(async () => root?.unmount());
  });

  it("keeps a saved-summary read failure visible after context succeeds", async () => {
    await act(async () => root?.unmount());
    controller = null;
    mocks.sendMessage.mockImplementation((message: PackMessage) => {
      if (message.type === "PACK_GET_CONTEXT") {
        return Promise.resolve({
          ok: true,
          context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
        });
      }
      if (message.type === "PACK_GET_FILED_RETURNS_FLOW_SUMMARY") {
        return Promise.resolve({
          ok: false,
          error: "BACKGROUND_MESSAGE_HANDLER_FAILED",
          safeMessage: "Pack stopped while handling saved local recovery state. Try again.",
        });
      }
      return Promise.resolve({ ok: true });
    });
    root = createRoot(document.getElementById("root") as Element);
    await act(async () => {
      root?.render(<Harness onChange={(next) => (controller = next)} />);
      await Promise.resolve();
    });

    const renderedController = controller as ReturnType<typeof usePackPopupController> | null;
    expect(renderedController?.context?.supported).toBe(true);
    expect(renderedController?.actionError).toBe(
      "Pack stopped while handling saved local recovery state. Try again.",
    );
  });

  it("keeps a context read safe error visible after the other mount reads succeed", async () => {
    await act(async () => root?.unmount());
    controller = null;
    mocks.sendMessage.mockImplementation((message: PackMessage) => {
      if (message.type === "PACK_GET_CONTEXT") {
        return Promise.resolve({
          ok: false,
          error: "BACKGROUND_MESSAGE_HANDLER_FAILED",
          safeMessage: "Pack stopped while handling the current GST Portal state. Try again.",
        });
      }
      return Promise.resolve({ ok: true, flowSummary: null });
    });
    root = createRoot(document.getElementById("root") as Element);
    await act(async () => {
      root?.render(<Harness onChange={(next) => (controller = next)} />);
      await Promise.resolve();
    });

    const renderedController = controller as ReturnType<typeof usePackPopupController> | null;
    expect(renderedController?.actionError).toBe(
      "Pack stopped while handling the current GST Portal state. Try again.",
    );
  });

  it("keeps a context refresh safe error visible", async () => {
    mocks.sendMessage.mockImplementation((message: PackMessage) =>
      message.type === "PACK_GET_CONTEXT"
        ? Promise.resolve({
            ok: false,
            error: "BACKGROUND_MESSAGE_HANDLER_FAILED",
            safeMessage: "Pack stopped while handling the current GST Portal state. Try again.",
          })
        : Promise.resolve({ ok: true }),
    );

    await act(async () => {
      await controller?.refreshPortalContext();
    });

    expect(controller?.actionError).toBe(
      "Pack stopped while handling the current GST Portal state. Try again.",
    );
  });

  it("keeps a summary-change safe error visible", async () => {
    mocks.sendMessage.mockImplementation((message: PackMessage) => {
      if (message.type === "PACK_GET_FILED_RETURNS_FLOW_SUMMARY") {
        return Promise.resolve({
          ok: false,
          error: "BACKGROUND_MESSAGE_HANDLER_FAILED",
          safeMessage: "Pack stopped while handling saved local recovery state. Try again.",
        });
      }
      return Promise.resolve({
        ok: true,
        context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
      });
    });

    await act(async () => {
      mocks.changeListeners.forEach((listener) =>
        listener({ "pack:last-filed-returns-flow-summary": { newValue: {} } }, "session"),
      );
      await Promise.resolve();
    });

    const renderedController = controller as ReturnType<typeof usePackPopupController> | null;
    expect(renderedController?.actionError).toBe(
      "Pack stopped while handling saved local recovery state. Try again.",
    );
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

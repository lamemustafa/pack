import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackMessage } from "../../src/connectors/gst/messages";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: { runtime: { sendMessage: mocks.sendMessage } },
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
});

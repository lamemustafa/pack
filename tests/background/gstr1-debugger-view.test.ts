import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/core/contracts";
import {
  clickGstr1ResultViewWithDebugger,
  type Gstr1DebuggerViewDeps,
} from "../../src/background/gstr1-debugger-view";

const SCOPE: FiledReturnsDownloadScope = {
  artifactType: "PDF",
  financialYear: "2025-26",
  period: "April",
  returnType: "GSTR-1",
};

function createDeps(overrides: Partial<Gstr1DebuggerViewDeps> = {}): Gstr1DebuggerViewDeps {
  return {
    attach: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
    dispatchMouseEvent: vi.fn(async () => undefined),
    hasPermission: vi.fn(async () => true),
    resolveViewPoint: vi.fn(async () => ({
      ok: true as const,
      gstr1ViewPoint: { x: 120, y: 240 },
    })),
    ...overrides,
  };
}

describe("target-bound GSTR-1 debugger View input", () => {
  it("does not attach when the local debugger permission is absent", async () => {
    const deps = createDeps({ hasPermission: vi.fn(async () => false) });

    const result = await clickGstr1ResultViewWithDebugger(42, SCOPE, deps);

    expect(result).toMatchObject({
      state: "user-action-required",
      safeSignals: expect.arrayContaining(["filed-gstr1-debugger-permission-required"]),
    });
    expect(deps.attach).not.toHaveBeenCalled();
    expect(deps.dispatchMouseEvent).not.toHaveBeenCalled();
    expect(deps.detach).not.toHaveBeenCalled();
  });

  it("dispatches one trusted mouse sequence at the exact resolved point and detaches", async () => {
    const deps = createDeps();

    const result = await clickGstr1ResultViewWithDebugger(42, SCOPE, deps);

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: expect.arrayContaining(["filed-gstr1-result-view-debugger-clicked"]),
    });
    expect(deps.attach).toHaveBeenCalledWith(42);
    expect(deps.resolveViewPoint).toHaveBeenNthCalledWith(1, 42, SCOPE);
    expect(deps.resolveViewPoint).toHaveBeenNthCalledWith(2, 42, SCOPE);
    expect(deps.dispatchMouseEvent).toHaveBeenNthCalledWith(1, 42, "mouseMoved", {
      x: 120,
      y: 240,
    });
    expect(deps.dispatchMouseEvent).toHaveBeenNthCalledWith(2, 42, "mousePressed", {
      x: 120,
      y: 240,
    });
    expect(deps.dispatchMouseEvent).toHaveBeenNthCalledWith(3, 42, "mouseReleased", {
      x: 120,
      y: 240,
    });
    expect(deps.dispatchMouseEvent).toHaveBeenCalledTimes(3);
    expect(deps.detach).toHaveBeenCalledWith(42);
  });

  it("does not attach or dispatch input when target-bound point resolution fails", async () => {
    const deps = createDeps({
      resolveViewPoint: vi.fn(async () => ({
        ok: true as const,
        flowStep: {
          connectorId: "gst" as const,
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "blocked" as const,
          safeSignals: ["filed-return-result-row-ambiguous"],
          safeMessage: "More than one result is visible.",
        },
      })),
    });

    const result = await clickGstr1ResultViewWithDebugger(42, SCOPE, deps);

    expect(result.safeSignals).toContain("filed-return-result-row-ambiguous");
    expect(deps.attach).not.toHaveBeenCalled();
    expect(deps.dispatchMouseEvent).not.toHaveBeenCalled();
    expect(deps.detach).not.toHaveBeenCalled();
  });

  it("keeps point-resolution transport failures on the manual recovery path", async () => {
    const deps = createDeps({
      resolveViewPoint: vi.fn(async () => {
        throw new Error("synthetic content-script failure");
      }),
    });

    const result = await clickGstr1ResultViewWithDebugger(42, SCOPE, deps);

    expect(result).toMatchObject({
      state: "user-action-required",
      safeSignals: expect.arrayContaining(["filed-gstr1-debugger-view-point-unavailable"]),
    });
    expect(deps.attach).not.toHaveBeenCalled();
    expect(deps.detach).not.toHaveBeenCalled();
  });

  it("detaches without input when the target changes after attachment", async () => {
    const resolveViewPoint = vi
      .fn<Gstr1DebuggerViewDeps["resolveViewPoint"]>()
      .mockResolvedValueOnce({
        ok: true,
        gstr1ViewPoint: { x: 120, y: 240 },
      })
      .mockResolvedValueOnce({
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "blocked",
          safeSignals: ["filed-return-result-row-ambiguous"],
          safeMessage: "The result changed after attachment.",
        },
      });
    const deps = createDeps({ resolveViewPoint });

    const result = await clickGstr1ResultViewWithDebugger(42, SCOPE, deps);

    expect(result.safeSignals).toContain("filed-return-result-row-ambiguous");
    expect(deps.attach).toHaveBeenCalledWith(42);
    expect(deps.dispatchMouseEvent).not.toHaveBeenCalled();
    expect(deps.detach).toHaveBeenCalledWith(42);
  });

  it("detaches and returns a retryable manual fallback when input dispatch fails", async () => {
    const deps = createDeps({
      dispatchMouseEvent: vi.fn(async () => {
        throw new Error("synthetic failure");
      }),
    });

    const result = await clickGstr1ResultViewWithDebugger(42, SCOPE, deps);

    expect(result).toMatchObject({
      state: "user-action-required",
      safeSignals: expect.arrayContaining(["filed-gstr1-debugger-input-unavailable"]),
    });
    expect(deps.detach).toHaveBeenCalledWith(42);
  });
});

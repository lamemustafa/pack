import { describe, expect, it } from "vitest";
import type { FiledReturnsDownloadTarget, PortalFlowStepResult } from "../../src/core/contracts";
import type { PackMessageResponse } from "../../src/core/messages";
import {
  shouldFallBackAfterCaptureFailure,
  targetBoundPortalClickObservationTimeoutMs,
  withCaptureFallbackSignal,
} from "../../src/connectors/gst/filed-returns-download-fallback";

const BASE_TARGET: FiledReturnsDownloadTarget = {
  actionId: "action-1",
  artifactType: "PDF",
  financialYear: "2025-26",
  period: "April",
  returnType: "GSTR-1",
};

function captureFailure(signal: string): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "blocked",
      safeSignals: [signal],
      safeMessage: "Capture failed.",
    },
  };
}

describe("filed-return capture fallback", () => {
  it("does not re-click after a GSTR-3B capture timeout", () => {
    const target = { ...BASE_TARGET, returnType: "GSTR-3B" as const };
    const response = captureFailure("filed-gstr3b-main-world-capture-timeout");

    expect(shouldFallBackAfterCaptureFailure(response, target)).toBe(false);
  });

  it("does not re-click after a GSTR-1 capture timeout", () => {
    const response = captureFailure("filed-gstr1-main-world-capture-timeout");

    expect(shouldFallBackAfterCaptureFailure(response, BASE_TARGET)).toBe(false);
  });

  it("uses one target-bound GSTR-1 portal click after an Excel capture failure", () => {
    expect(
      shouldFallBackAfterCaptureFailure(captureFailure("filed-gstr1-blob-capture-failed"), {
        ...BASE_TARGET,
        artifactType: "EXCEL",
      }),
    ).toBe(true);
  });

  it("does not click again when GSTR-1 reports that Excel details are unavailable", () => {
    const response = captureFailure("filed-gstr1-main-world-capture-timeout");
    if (response.ok && "flowStep" in response) {
      response.flowStep.safeSignals.push("filed-gstr1-excel-no-details-available");
    }

    expect(
      shouldFallBackAfterCaptureFailure(response, { ...BASE_TARGET, artifactType: "EXCEL" }),
    ).toBe(false);
  });

  it.each(["PDF", "EXCEL"] as const)(
    "uses one target-bound GSTR-2B portal click after a failed %s capture",
    (artifactType) => {
      const target = {
        ...BASE_TARGET,
        artifactType,
        returnType: "GSTR-2B" as const,
      };
      const response = captureFailure("gstr2b-blob-capture-failed");

      expect(shouldFallBackAfterCaptureFailure(response, target)).toBe(true);
      expect(withCaptureFallbackSignal(response, target)).toMatchObject({
        flowStep: {
          safeSignals: expect.arrayContaining(["filed-gstr2b-capture-fallback-portal-click"]),
        } satisfies Partial<PortalFlowStepResult>,
      });
    },
  );

  it("never adds another fallback after the target-bound portal click", () => {
    expect(
      shouldFallBackAfterCaptureFailure(captureFailure("gstr2b-blob-capture-failed"), {
        ...BASE_TARGET,
        forcePortalClick: true,
        returnType: "GSTR-2B",
      }),
    ).toBe(false);
  });

  it("never adds another GSTR-1 fallback after the target-bound portal click", () => {
    expect(
      shouldFallBackAfterCaptureFailure(captureFailure("filed-gstr1-main-world-capture-timeout"), {
        ...BASE_TARGET,
        forcePortalClick: true,
      }),
    ).toBe(false);
  });

  it("keeps the target-bound fallback observation window scoped to two minutes", () => {
    expect(targetBoundPortalClickObservationTimeoutMs()).toBe(120_000);
  });
});

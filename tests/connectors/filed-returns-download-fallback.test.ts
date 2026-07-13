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
  it("keeps one target-bound portal-click fallback for a GSTR-3B capture timeout", () => {
    const target = { ...BASE_TARGET, returnType: "GSTR-3B" as const };
    const response = captureFailure("filed-gstr3b-main-world-capture-timeout");

    expect(shouldFallBackAfterCaptureFailure(response, target)).toBe(true);
    expect(withCaptureFallbackSignal(response, target)).toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining(["filed-gstr3b-capture-fallback-portal-click"]),
      } satisfies Partial<PortalFlowStepResult>,
    });
  });

  it("does not add a second portal click for GSTR-1 capture failures", () => {
    const response = captureFailure("filed-gstr1-main-world-capture-timeout");

    expect(shouldFallBackAfterCaptureFailure(response, BASE_TARGET)).toBe(false);
  });

  it("does not broaden the fallback to GSTR-1 Excel or GSTR-2B", () => {
    expect(
      shouldFallBackAfterCaptureFailure(captureFailure("filed-gstr1-blob-capture-failed"), {
        ...BASE_TARGET,
        artifactType: "EXCEL",
      }),
    ).toBe(false);
    expect(
      shouldFallBackAfterCaptureFailure(captureFailure("filed-gstr2b-blob-capture-failed"), {
        ...BASE_TARGET,
        returnType: "GSTR-2B",
      }),
    ).toBe(false);
  });

  it("keeps the target-bound fallback observation window scoped to two minutes", () => {
    expect(targetBoundPortalClickObservationTimeoutMs()).toBe(120_000);
  });
});

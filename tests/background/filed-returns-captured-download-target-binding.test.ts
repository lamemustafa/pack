import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadTarget,
  FiledReturnsMainWorldCaptureRequest,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import type { FiledReturnsFlowMessagingDeps } from "../../src/background/filed-returns-flow-messaging";

const browserMocks = vi.hoisted(() => ({
  scripting: { executeScript: vi.fn() },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

import { startMainWorldCapturedFiledReturnDownload } from "../../src/background/filed-returns-captured-download";

describe("filed-return captured download target binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      name: "missing binding",
      mutate: (request: FiledReturnsMainWorldCaptureRequest) => {
        (request as unknown as { targetBinding?: unknown }).targetBinding = undefined;
      },
    },
    {
      name: "action",
      mutate: (request: FiledReturnsMainWorldCaptureRequest) => {
        request.actionId = "different-action";
      },
    },
    {
      name: "financial year",
      mutate: (request: FiledReturnsMainWorldCaptureRequest) => {
        request.targetBinding.financialYear = "2025-26";
      },
    },
    {
      name: "period",
      mutate: (request: FiledReturnsMainWorldCaptureRequest) => {
        request.targetBinding.period = "June";
      },
    },
    {
      name: "return",
      mutate: (request: FiledReturnsMainWorldCaptureRequest) => {
        request.targetBinding.returnType = "GSTR-1";
      },
    },
    {
      name: "artifact",
      mutate: (request: FiledReturnsMainWorldCaptureRequest) => {
        request.targetBinding.artifactType = "EXCEL";
      },
    },
  ])("rejects a mismatched $name before MAIN-world scripting", async ({ mutate }) => {
    const request = captureRequest();
    mutate(request);

    const response = await startMainWorldCapturedFiledReturnDownload({
      activePeriod: "May",
      armedAt: new Date("2026-07-24T00:00:00.000Z"),
      artifactType: "PDF",
      deps: unusedMessagingDeps(),
      mainWorldCaptureRequest: request,
      scope: {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      },
      tabId: 17,
      target: captureTarget(),
      triggerStep: triggerStep(),
    });

    expect(browserMocks.scripting.executeScript).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).toContain("filed-gstr2b-captured-download-target-mismatch");
  });
});

function captureRequest(): FiledReturnsMainWorldCaptureRequest {
  return {
    actionId: "action-1",
    controlAttribute: "data-pack-gstr2b-capture-action",
    controlId: "capture-1",
    maxBytes: 36 * 1024 * 1024,
    signalPrefix: "filed-gstr2b",
    targetBinding: {
      artifactType: "PDF",
      controlTextDigest: "1234abcd",
      financialYear: "2026-27",
      pathnameDigest: "abcd1234",
      period: "May",
      returnType: "GSTR-2B",
    },
  };
}

function captureTarget(): FiledReturnsDownloadTarget {
  return {
    actionId: "action-1",
    artifactType: "PDF",
    financialYear: "2026-27",
    period: "May",
    returnType: "GSTR-2B",
  };
}

function triggerStep(): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
    state: "clicked",
    safeMessage: "Capture armed.",
    safeSignals: ["filed-gstr2b-download-clicked"],
  };
}

function unusedMessagingDeps(): FiledReturnsFlowMessagingDeps {
  return {
    sendMessageToTabWithInjection: vi.fn(),
    storageKeys: { targetReview: "target-review" },
  };
}

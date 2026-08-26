import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSinglePeriodStagingRecord,
  combineDownloadedArtifactFlowSteps,
  persistPartialArtifactSummary,
  readPersistedArtifactProgress,
  reserveSinglePeriodBundleLedger,
} from "../../src/background/filed-returns-artifact-progress";
import {
  hasPositiveFiledReturnsDownloadEvidence,
  isValidFiledReturnsDownloadDiagnosticState,
} from "../../src/background/filed-returns-download-diagnostic-state";
import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";

const state = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
}));

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: state.local[key] })),
      remove: vi.fn(async (key: string) => {
        delete state.local[key];
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(state.local, values);
      }),
    },
    session: {
      get: vi.fn(async (key: string) => ({ [key]: state.session[key] })),
      remove: vi.fn(async (key: string) => {
        delete state.session[key];
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(state.session, values);
      }),
    },
  },
}));

const offscreenMocks = vi.hoisted(() => ({
  clearOffscreenFiledReturnLedger: vi.fn<
    () => Promise<
      | { status: "cleared" }
      | {
          status: "failed";
          errorCategory?:
            | "clear-failed"
            | "offscreen-response-invalid"
            | "offscreen-unreachable"
            | "opfs-unavailable";
        }
    >
  >(async () => ({ status: "cleared" })),
  closeOffscreenBlobDocument: vi.fn(async () => undefined),
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));
vi.mock("../../src/background/offscreen-blob-url", () => offscreenMocks);

describe("single-period filed-return staging ownership", () => {
  beforeEach(() => {
    state.local = {};
    state.session = {};
    vi.clearAllMocks();
    offscreenMocks.clearOffscreenFiledReturnLedger.mockResolvedValue({ status: "cleared" });
  });

  it("persists an opaque cleanup identity before returning a ledger id", async () => {
    const requestedScope = {
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-2B",
    } as const;
    const ledgerId = await reserveSinglePeriodBundleLedger();

    expect(ledgerId).not.toBeNull();
    if (!ledgerId) return;
    expect(ledgerId).toMatch(/^single-period:[a-zA-Z0-9._-]+$/);
    expect(state.local["pack:single-period-staging"]).toEqual({
      ledgerId,
      schemaVersion: "1.0",
    });
    expect(ledgerId).not.toContain(requestedScope.returnType);
    expect(ledgerId).not.toContain(requestedScope.financialYear);
    expect(ledgerId.toLowerCase()).not.toContain(requestedScope.period.toLowerCase());
  });

  it("preserves retained staging instead of repeating portal artifacts after restart", async () => {
    state.local["pack:single-period-staging"] = {
      ledgerId: "single-period:aaaaaaaaaaaaaaaaaaaa",
      schemaVersion: "1.0",
    };

    const ledgerId = await reserveSinglePeriodBundleLedger();

    expect(ledgerId).toBeNull();
    expect(offscreenMocks.clearOffscreenFiledReturnLedger).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(state.local["pack:single-period-staging"]).toEqual({
      ledgerId: "single-period:aaaaaaaaaaaaaaaaaaaa",
      schemaVersion: "1.0",
    });
  });

  it("does not let cleanup availability change retained staging ownership", async () => {
    state.local["pack:single-period-staging"] = {
      ledgerId: "single-period:aaaaaaaaaaaaaaaaaaaa",
      schemaVersion: "1.0",
    };
    offscreenMocks.clearOffscreenFiledReturnLedger.mockResolvedValue({ status: "failed" });

    const ledgerId = await reserveSinglePeriodBundleLedger();

    expect(ledgerId).toBeNull();
    expect(offscreenMocks.clearOffscreenFiledReturnLedger).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    expect(state.local["pack:single-period-staging"]).toEqual({
      ledgerId: "single-period:aaaaaaaaaaaaaaaaaaaa",
      schemaVersion: "1.0",
    });
  });

  it("fails closed when durable staging ownership cannot be read", async () => {
    browserMocks.storage.local.get.mockRejectedValueOnce(new Error("synthetic storage failure"));

    await expect(reserveSinglePeriodBundleLedger()).resolves.toBeNull();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("fails closed when durable staging ownership is malformed", async () => {
    state.local["pack:single-period-staging"] = { schemaVersion: "unexpected" };

    await expect(reserveSinglePeriodBundleLedger()).resolves.toBeNull();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("fails closed when a current-schema staging id is not Pack-owned", async () => {
    state.local["pack:single-period-staging"] = {
      ledgerId: "untrusted-ledger",
      schemaVersion: "1.0",
    };

    await expect(reserveSinglePeriodBundleLedger()).resolves.toBeNull();
    expect(offscreenMocks.clearOffscreenFiledReturnLedger).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("removes only the record owned by the cleared ledger", async () => {
    state.local["pack:single-period-staging"] = {
      ledgerId: "single-period:bbbbbbbbbbbbbbbbbbbb",
      schemaVersion: "1.0",
    };

    await expect(
      clearSinglePeriodStagingRecord("single-period:eeeeeeeeeeeeeeeeeeee"),
    ).resolves.toBe(false);
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();

    await expect(
      clearSinglePeriodStagingRecord("single-period:bbbbbbbbbbbbbbbbbbbb"),
    ).resolves.toBe(true);
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("pack:single-period-staging");
  });

  it("does not report durable cleanup when the ownership record cannot be removed", async () => {
    state.local["pack:single-period-staging"] = {
      ledgerId: "single-period:bbbbbbbbbbbbbbbbbbbb",
      schemaVersion: "1.0",
    };
    browserMocks.storage.local.remove.mockRejectedValueOnce(new Error("synthetic remove failure"));

    await expect(
      clearSinglePeriodStagingRecord("single-period:bbbbbbbbbbbbbbbbbbbb"),
    ).resolves.toBe(false);
    expect(state.local["pack:single-period-staging"]).toEqual({
      ledgerId: "single-period:bbbbbbbbbbbbbbbbbbbb",
      schemaVersion: "1.0",
    });
  });
});

describe("durable selected-artifact progress", () => {
  const scope: FiledReturnsDownloadScope = {
    artifactType: "PDF_AND_EXCEL",
    financialYear: "2025-26",
    period: "May",
    returnType: "GSTR-1",
  };
  const deps = {
    storageKeys: {
      completion: "completion",
      fullFiscalYearLedger: "ledger",
      observation: "observation",
    },
  } as FiledReturnsFlowRunnerDeps;

  beforeEach(() => {
    state.session = {};
    vi.clearAllMocks();
  });

  it("persists and reads only canonical artifact progress copy", async () => {
    const immediate = await persistPartialArtifactSummary(
      scope,
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["filed-return-artifact-downloaded:PDF"],
        safeMessage: "Synthetic Taxpayer GSTIN 00XXXXX0000X0Z0 downloaded.",
      },
      deps,
    );

    expect(immediate.flowStep.safeMessage).toContain("00XXXXX0000X0Z0");
    expect(
      (state.session.completion as { flowStep: { safeMessage: string } }).flowStep.safeMessage,
    ).not.toContain("00XXXXX0000X0Z0");
    await expect(
      readPersistedArtifactProgress(scope, ["PDF", "EXCEL"], deps),
    ).resolves.toMatchObject({ completedArtifactTypes: ["PDF"] });
  });

  it("keeps genuinely missing selected-artifact progress retryable", async () => {
    await expect(readPersistedArtifactProgress(scope, ["PDF", "EXCEL"], deps)).resolves.toBeNull();
    expect(browserMocks.storage.session.remove).not.toHaveBeenCalled();
    expect(browserMocks.storage.session.set).not.toHaveBeenCalled();
  });

  it("recovers completed GSTR-2B JSON alongside the selected PDF and Excel artifacts", async () => {
    const gstr2bScope: FiledReturnsDownloadScope = {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    };
    await persistPartialArtifactSummary(
      gstr2bScope,
      {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "blocked",
        safeSignals: [
          "filed-return-artifact-downloaded:PDF",
          "filed-return-artifact-downloaded:JSON",
          "filed-return-artifact-failed:EXCEL",
        ],
        safeMessage: "Synthetic GSTR-2B artifact progress.",
      },
      deps,
    );

    await expect(
      readPersistedArtifactProgress(gstr2bScope, ["PDF", "EXCEL", "JSON"], deps),
    ).resolves.toMatchObject({ completedArtifactTypes: ["PDF", "JSON"] });
  });

  it("redacts malformed selected-artifact progress and retains its blocked reason", async () => {
    state.session.completion = { unknown: "synthetic noncanonical value" };

    await expect(readPersistedArtifactProgress(scope, ["PDF", "EXCEL"], deps)).resolves.toEqual({
      reason: "malformed-summary",
      state: "blocked",
    });
    expect(state.session.completion).toMatchObject({
      flowStep: {
        safeSignals: ["filed-return-artifact-progress-malformed-summary"],
        state: "blocked",
      },
      status: "blocked",
    });
    expect(JSON.stringify(state.session.completion)).not.toContain("synthetic noncanonical value");
    expect(browserMocks.storage.session.remove).not.toHaveBeenCalled();
    await expect(readPersistedArtifactProgress(scope, ["PDF", "EXCEL"], deps)).resolves.toEqual({
      reason: "malformed-summary",
      state: "blocked",
    });
  });

  it("blocks when malformed selected-artifact progress cannot be redacted", async () => {
    state.session.completion = { unknown: "synthetic noncanonical value" };
    browserMocks.storage.session.set.mockRejectedValueOnce(
      new Error("synthetic redaction write failure"),
    );

    await expect(readPersistedArtifactProgress(scope, ["PDF", "EXCEL"], deps)).resolves.toEqual({
      reason: "storage-write-failed",
      state: "blocked",
    });
    expect(state.session.completion).toEqual({ unknown: "synthetic noncanonical value" });
  });

  it("does not turn an unavailable progress read into missing progress", async () => {
    browserMocks.storage.session.get.mockRejectedValueOnce(
      new Error("synthetic session read failure"),
    );

    await expect(readPersistedArtifactProgress(scope, ["PDF", "EXCEL"], deps)).resolves.toEqual({
      reason: "storage-read-failed",
      state: "blocked",
    });
  });

  it("distinguishes a canonical progress write failure from a read failure", async () => {
    await persistPartialArtifactSummary(
      scope,
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["filed-return-artifact-downloaded:PDF"],
        safeMessage: "Synthetic selected-artifact progress.",
      },
      deps,
    );
    browserMocks.storage.session.set.mockRejectedValueOnce(
      new Error("synthetic session write failure"),
    );

    await expect(readPersistedArtifactProgress(scope, ["PDF", "EXCEL"], deps)).resolves.toEqual({
      reason: "storage-write-failed",
      state: "blocked",
    });
  });

  it("does not retain partial progress with an unknown signal", async () => {
    state.session.completion = { stale: true };
    await persistPartialArtifactSummary(
      scope,
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["synthetic-portal-option-value"],
        safeMessage: "Synthetic Taxpayer status.",
      },
      deps,
    );

    expect(state.session.completion).toBeUndefined();
  });
});

describe("selected-artifact download diagnostics", () => {
  const scope: FiledReturnsDownloadScope = {
    artifactType: "PDF_AND_EXCEL",
    financialYear: "2025-26",
    period: "May",
    returnType: "GSTR-1",
  };

  it("retains one latest diagnostic per artifact and mirrors the latest entry", () => {
    const pdf = diagnostic("PDF", "action-m0abc123-pdf00001");
    const excel = diagnostic("EXCEL", "action-m0abc123-excel001");
    const combined = combineDownloadedArtifactFlowSteps(flowStep(pdf), flowStep(excel), scope);

    expect(combined.downloadDiagnostics).toEqual([pdf, excel]);
    expect(combined.downloadDiagnostic).toEqual(excel);

    const retriedPdf = diagnostic("PDF", "action-m0abc123-pdf00002");
    const retried = combineDownloadedArtifactFlowSteps(combined, flowStep(retriedPdf), scope);
    expect(retried.downloadDiagnostics).toEqual([excel, retriedPdf]);
    expect(retried.downloadDiagnostic).toEqual(retriedPdf);
  });

  it("accepts legacy singular-only evidence without fabricating an array", () => {
    const pdf = diagnostic("PDF", "action-m0abc123-pdf00001");
    const legacy = flowStep(pdf);
    const nextStep: PortalFlowStepResult = {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "blocked",
      safeSignals: ["synthetic-retry-required"],
      safeMessage: "Synthetic retry required.",
    };

    const combined = combineDownloadedArtifactFlowSteps(legacy, nextStep, scope);
    expect(combined.downloadDiagnostic).toEqual(pdf);
    expect(combined).not.toHaveProperty("downloadDiagnostics");
  });

  it("requires non-empty evidence bound to the exact staging mode", () => {
    const stagedPdf = { ...diagnostic("PDF", "action-m0abc123-pdf00001") };
    delete stagedPdf.downloadId;

    expect(
      hasPositiveFiledReturnsDownloadEvidence(
        { downloadDiagnostic: stagedPdf },
        { ...scope, artifactType: "PDF" },
        ["single-period-opfs-staged:PDF"],
        "single-period",
      ),
    ).toBe(true);
    expect(
      hasPositiveFiledReturnsDownloadEvidence(
        { downloadDiagnostic: stagedPdf },
        { ...scope, artifactType: "PDF" },
        ["full-fiscal-year-opfs-staged:PDF"],
        "single-period",
      ),
    ).toBe(false);
    expect(
      hasPositiveFiledReturnsDownloadEvidence(
        {
          downloadDiagnostic: { ...stagedPdf, byteCountClass: "unknown" },
        },
        { ...scope, artifactType: "PDF" },
        ["single-period-opfs-staged:PDF"],
        "single-period",
      ),
    ).toBe(false);
  });

  it("accepts only exact non-empty GSTR-3B evidence on the target-bound portal path", () => {
    const gstr3bScope: FiledReturnsDownloadScope = {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    };
    const targetBound: FiledReturnsDownloadDiagnostic = {
      schemaVersion: "1.0",
      eventType: "filed-return-download-path",
      actionId: "action-m0abc123-gstr3b01",
      artifactType: "PDF",
      byteCountClass: "non-empty",
      downloadId: 81,
      downloadPathClass: "target-bound-portal-click-blob",
      endpointClass: "gstr3b-portal-rendered-download",
      financialYear: "2026-27",
      mimeClass: "pdf",
      period: "May",
      returnType: "GSTR-3B",
      status: "downloaded",
    };

    expect(
      hasPositiveFiledReturnsDownloadEvidence(
        { downloadDiagnostic: targetBound },
        gstr3bScope,
        ["filed-return-artifact-downloaded:PDF"],
        null,
      ),
    ).toBe(true);

    const withoutDownloadId = { ...targetBound };
    delete withoutDownloadId.downloadId;
    for (const rejected of [
      { ...targetBound, downloadPathClass: "portal-click-blob" as const },
      withoutDownloadId,
      { ...targetBound, byteCountClass: "zero" as const },
      { ...targetBound, mimeClass: "generic-binary" as const },
      { ...targetBound, endpointClass: "filed-return-portal-rendered-download" as const },
    ]) {
      expect(
        hasPositiveFiledReturnsDownloadEvidence(
          { downloadDiagnostic: rejected },
          gstr3bScope,
          ["filed-return-artifact-downloaded:PDF"],
          null,
        ),
      ).toBe(false);
    }
  });

  it("fails closed on reused actions, mismatched targets, or extra diagnostic fields", () => {
    const pdf = diagnostic("PDF", "action-m0abc123-shared00");
    const reusedAction = diagnostic("EXCEL", "action-m0abc123-shared00");
    const combined = combineDownloadedArtifactFlowSteps(
      flowStep(pdf),
      flowStep(reusedAction),
      scope,
    );
    expect(combined).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining(["filed-return-download-diagnostics-rejected"]),
      downloadDiagnostic: pdf,
    });
    expect(combined).not.toHaveProperty("downloadDiagnostics");

    expect(
      isValidFiledReturnsDownloadDiagnosticState(
        {
          downloadDiagnostic: {
            ...pdf,
            financialYear: "2024-25",
          },
        },
        scope,
      ),
    ).toBe(false);
    expect(
      isValidFiledReturnsDownloadDiagnosticState(
        { downloadDiagnostic: { ...pdf, endpointClass: "unknown" } },
        scope,
      ),
    ).toBe(false);
    expect(
      isValidFiledReturnsDownloadDiagnosticState(
        {
          downloadDiagnostic: { ...pdf, rawUrl: "synthetic-forbidden" },
        },
        scope,
      ),
    ).toBe(false);
    expect(
      isValidFiledReturnsDownloadDiagnosticState(
        {
          downloadDiagnostic: {
            ...pdf,
            endpointClass: "gstr1-excel-portal-blob-captured-download",
          },
        },
        scope,
      ),
    ).toBe(false);
    expect(
      isValidFiledReturnsDownloadDiagnosticState(
        {
          downloadDiagnostic: {
            ...pdf,
            endpointClass: "gstr1-pdf-portal-rendered-download",
            downloadPathClass: "portal-click-https",
          },
        },
        scope,
      ),
    ).toBe(false);
    expect(
      isValidFiledReturnsDownloadDiagnosticState(
        {
          downloadDiagnostic: reusedAction,
          downloadDiagnostics: [
            pdf,
            reusedAction,
            { ...pdf, actionId: "action-m0abc123-third000" },
          ],
        },
        scope,
      ),
    ).toBe(false);
    expect(isValidFiledReturnsDownloadDiagnosticState({ downloadDiagnostics: [pdf] }, scope)).toBe(
      false,
    );

    for (const errorCategory of [
      "browser-download-error-raw-url-like-value",
      "filed-gstr1-main-world-capture-timeout-unreviewed-suffix",
      "synthetic-file-name.pdf",
      "synthetic-local-path-value",
      "synthetic-portal-text-value",
    ]) {
      expect(
        isValidFiledReturnsDownloadDiagnosticState(
          { downloadDiagnostic: { ...pdf, errorCategory } },
          scope,
        ),
      ).toBe(false);
    }
    expect(
      isValidFiledReturnsDownloadDiagnosticState(
        {
          downloadDiagnostic: {
            ...pdf,
            errorCategory: "filed-gstr1-main-world-capture-timeout",
          },
        },
        scope,
      ),
    ).toBe(true);
  });

  function diagnostic(
    artifactType: "PDF" | "EXCEL",
    actionId: string,
  ): FiledReturnsDownloadDiagnostic {
    return {
      schemaVersion: "1.0",
      eventType: "filed-return-download-path",
      actionId,
      returnType: "GSTR-1",
      financialYear: "2025-26",
      period: "May",
      endpointClass:
        artifactType === "PDF"
          ? "gstr1-pdf-portal-blob-captured-download"
          : "gstr1-excel-portal-blob-captured-download",
      artifactType,
      downloadPathClass: "captured-portal-request-blob",
      downloadId: artifactType === "PDF" ? 41 : 42,
      status: "downloaded",
      mimeClass: artifactType === "PDF" ? "pdf" : "spreadsheet",
      byteCountClass: "non-empty",
    };
  }

  function flowStep(downloadDiagnostic: FiledReturnsDownloadDiagnostic): PortalFlowStepResult {
    return {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "downloaded",
      safeSignals: [`filed-return-artifact-downloaded:${downloadDiagnostic.artifactType}`],
      safeMessage: "Synthetic artifact downloaded.",
      downloadDiagnostic,
    };
  }
});

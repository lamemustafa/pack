import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import { persistFlowResponse } from "../../src/background/filed-returns-flow-runner-utils";
import { artifactAcquisitionCheckpointKey } from "../../src/background/artifact-acquisition-state";
import { persistSummary } from "../../src/background/filed-returns-full-fiscal-year-run-state";
import {
  persistCanonicalFiledReturnsFlowSummary,
  readCanonicalFiledReturnsFlowSummary,
} from "../../src/background/filed-returns-session-summary";
import { withPersistedSinglePeriodSummary } from "../../src/background/filed-returns-single-period-summary";
import {
  ARTIFACT_FAILURE_MESSAGES,
  type ArtifactFailureReason,
} from "../../src/connectors/gst/artifact-source";
import { isDurableFiledReturnsSignal } from "../../src/connectors/gst/filed-returns-durable-signals";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import {
  FILED_RETURNS_RETURN_TYPES,
  filedReturnsScopeId,
} from "../../src/connectors/gst/filed-returns-return-types";
import {
  GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES,
  Gstr2bArtifactDispatchFailureReason,
} from "../../src/background/filed-returns-download-trigger";
import {
  FILED_RETURNS_PORTAL_BLOCKED_OR_SESSION_EXPIRED_MESSAGE,
  FILED_RETURNS_PORTAL_SCHEDULED_DOWNTIME_MESSAGE,
  FILED_RETURNS_PORTAL_SYSTEM_ERROR_MESSAGE,
} from "../../src/connectors/gst/filed-returns-portal-availability";

const storage = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storage.session[key] })),
        remove: vi.fn(async (key: string) => {
          delete storage.session[key];
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(storage.session, values);
        }),
      },
    },
  },
}));

const COMPLETION_KEY = "completion";
const OBSERVATION_KEY = "observation";
const deps: FiledReturnsFlowRunnerDeps = {
  getActiveGstTab: vi.fn(async () => null),
  sendMessageToTabWithInjection: vi.fn<FiledReturnsFlowRunnerDeps["sendMessageToTabWithInjection"]>(
    async () => ({ ok: false, error: "Synthetic unused dependency." }),
  ),
  storageKeys: {
    completion: COMPLETION_KEY,
    fullFiscalYearLedger: "ledger",
    observation: OBSERVATION_KEY,
  },
};

describe("filed-return session write boundary", () => {
  beforeEach(() => {
    storage.session = {};
    vi.clearAllMocks();
  });

  it("reconstructs summary prose before direct persistence", async () => {
    const summary = await persistCanonicalFiledReturnsFlowSummary(
      COMPLETION_KEY,
      singlePeriodSummary(),
    );

    expect(summary?.flowStep).toMatchObject({
      safeMessage: "Pack needs an explicit recovery action before continuing March.",
      userAction: {
        type: "LOGIN",
        message: "Sign in to the GST Portal, then retry.",
        canResume: false,
      },
    });
    expect(JSON.stringify(storage.session[COMPLETION_KEY])).not.toContain("Synthetic Taxpayer Co.");
    expect(JSON.stringify(storage.session[COMPLETION_KEY])).not.toContain("account-specific");
  });

  it("removes stale completion state when a summary contains a non-canonical signal", async () => {
    storage.session[COMPLETION_KEY] = singlePeriodSummary();

    await expect(
      persistCanonicalFiledReturnsFlowSummary(
        COMPLETION_KEY,
        singlePeriodSummary({ safeSignals: ["synthetic-taxpayer-signal"] }),
      ),
    ).resolves.toBeNull();
    expect(storage.session[COMPLETION_KEY]).toBeUndefined();
  });

  it("persists a direct exact-ID completion before clearing its acquisition checkpoint", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-3B" as const,
    };
    const actionId = "00000000-0000-4000-8000-000000000091";
    const checkpointKey = artifactAcquisitionCheckpointKey(scope);
    storage.session[checkpointKey] = {
      ...scope,
      armedAt: "2026-08-05T08:00:00.000Z",
      downloadId: 91,
      requestId: actionId,
      state: "download-observing",
    };

    const response = await withPersistedSinglePeriodSummary(
      scope,
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: filedReturnsScopeId(scope.returnType),
          state: "downloaded",
          safeSignals: ["target-period-verified"],
          safeMessage: "Pack saved the selected filed return.",
          downloadDiagnostic: {
            actionId,
            artifactType: "PDF",
            byteCountClass: "non-empty",
            downloadId: 91,
            downloadPathClass: "captured-portal-request-unknown",
            endpointClass: "gstr3b-portal-blob-captured-download",
            eventType: "filed-return-download-path",
            financialYear: scope.financialYear,
            mimeClass: "pdf",
            period: scope.period,
            returnType: scope.returnType,
            schemaVersion: "1.0",
            status: "downloaded",
          },
        },
      },
      deps,
      true,
    );

    expect(response).toMatchObject({
      flowSummary: {
        flowStep: { downloadDiagnostic: { downloadId: 91 } },
        status: "complete",
      },
    });
    expect(storage.session[checkpointKey]).toBeUndefined();
  });

  it("persists a portal-blob captured completion before clearing its checkpoint", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-3B" as const,
    };
    const actionId = "00000000-0000-4000-8000-000000000092";
    const checkpointKey = artifactAcquisitionCheckpointKey(scope);
    storage.session[checkpointKey] = {
      ...scope,
      armedAt: "2026-08-05T08:00:00.000Z",
      downloadId: 92,
      requestId: actionId,
      state: "download-observing",
    };

    const response = await withPersistedSinglePeriodSummary(
      scope,
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: filedReturnsScopeId(scope.returnType),
          state: "downloaded",
          safeSignals: ["filed-gstr3b-portal-blob-download-captured"],
          safeMessage: "Pack saved the selected filed return.",
          downloadDiagnostic: {
            actionId,
            artifactType: "PDF",
            byteCountClass: "non-empty",
            downloadId: 92,
            downloadPathClass: "captured-portal-request-unknown",
            endpointClass: "gstr3b-portal-blob-captured-download",
            eventType: "filed-return-download-path",
            financialYear: scope.financialYear,
            mimeClass: "pdf",
            period: scope.period,
            returnType: scope.returnType,
            schemaVersion: "1.0",
            status: "downloaded",
          },
        },
      },
      deps,
      true,
    );

    expect(response).toMatchObject({ flowSummary: { status: "complete" } });
    expect(storage.session[checkpointKey]).toBeUndefined();
  });

  it("persists a GSTR-1 page-generated PDF completion before clearing its checkpoint", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-1" as const,
    };
    const actionId = "00000000-0000-4000-8000-000000000095";
    const checkpointKey = artifactAcquisitionCheckpointKey(scope);
    storage.session[checkpointKey] = {
      ...scope,
      armedAt: "2026-08-05T08:00:00.000Z",
      downloadId: 95,
      requestId: actionId,
      state: "download-observing",
    };

    const response = await withPersistedSinglePeriodSummary(
      scope,
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: filedReturnsScopeId(scope.returnType),
          state: "downloaded",
          safeSignals: [
            "target-period-verified",
            "page-generated-pdf-ready",
            "filed-gstr1-portal-blob-download-captured",
          ],
          safeMessage: "Pack saved the selected filed return.",
          downloadDiagnostic: {
            actionId,
            artifactType: "PDF",
            byteCountClass: "non-empty",
            downloadId: 95,
            downloadPathClass: "captured-portal-request-unknown",
            endpointClass: "gstr1-pdf-portal-blob-captured-download",
            eventType: "filed-return-download-path",
            financialYear: scope.financialYear,
            mimeClass: "pdf",
            period: scope.period,
            returnType: scope.returnType,
            schemaVersion: "1.0",
            status: "downloaded",
          },
        },
      },
      deps,
      true,
    );

    expect(response).toMatchObject({ flowSummary: { status: "complete" } });
    expect(storage.session[checkpointKey]).toBeUndefined();
  });

  it("persists a GSTR-3B JSON capture before clearing its exact-ID checkpoint", async () => {
    const scope = {
      artifactType: "JSON" as const,
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-3B" as const,
    };
    const actionId = "00000000-0000-4000-8000-000000000093";
    const checkpointKey = artifactAcquisitionCheckpointKey(scope);
    storage.session[checkpointKey] = {
      ...scope,
      armedAt: "2026-08-05T08:00:00.000Z",
      downloadId: 93,
      requestId: actionId,
      state: "download-observing",
    };

    const response = await withPersistedSinglePeriodSummary(
      scope,
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: filedReturnsScopeId(scope.returnType),
          state: "downloaded",
          safeSignals: ["target-period-verified"],
          safeMessage: "Pack saved the portal-produced GSTR-3B data JSON.",
          downloadDiagnostic: {
            actionId,
            artifactType: "JSON",
            byteCountClass: "non-empty",
            downloadId: 93,
            downloadPathClass: "captured-portal-request-unknown",
            endpointClass: "gstr3b-main-world-json-captured-download",
            eventType: "filed-return-download-path",
            financialYear: scope.financialYear,
            mimeClass: "json",
            period: scope.period,
            returnType: scope.returnType,
            schemaVersion: "1.0",
            status: "downloaded",
          },
        },
      },
      deps,
      true,
    );

    expect(response).toMatchObject({ flowSummary: { status: "complete" } });
    expect(storage.session[checkpointKey]).toBeUndefined();
  });

  it("persists a GSTR-2B JSON capture before clearing its exact-ID checkpoint", async () => {
    const scope = {
      artifactType: "JSON" as const,
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-2B" as const,
    };
    const actionId = "00000000-0000-4000-8000-000000000094";
    const checkpointKey = artifactAcquisitionCheckpointKey(scope);
    storage.session[checkpointKey] = {
      ...scope,
      armedAt: "2026-08-05T08:00:00.000Z",
      downloadId: 94,
      requestId: actionId,
      state: "download-observing",
    };

    const response = await withPersistedSinglePeriodSummary(
      scope,
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: filedReturnsScopeId(scope.returnType),
          state: "downloaded",
          safeSignals: ["target-period-verified"],
          safeMessage: "Pack saved the portal-produced GSTR-2B data JSON.",
          downloadDiagnostic: {
            actionId,
            artifactType: "JSON",
            byteCountClass: "non-empty",
            downloadId: 94,
            downloadPathClass: "captured-portal-request-unknown",
            endpointClass: "gstr2b-main-world-json-captured-download",
            eventType: "filed-return-download-path",
            financialYear: scope.financialYear,
            mimeClass: "json",
            period: scope.period,
            returnType: scope.returnType,
            schemaVersion: "1.0",
            status: "downloaded",
          },
        },
      },
      deps,
      true,
    );

    expect(response).toMatchObject({ flowSummary: { status: "complete" } });
    expect(storage.session[checkpointKey]).toBeUndefined();
  });

  it("persists a restart-safe GSTR-1 Return Dashboard navigation failure", async () => {
    const response = await withPersistedSinglePeriodSummary(
      {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-1",
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
          state: "candidate-not-found",
          safeSignals: [
            "gstr1-filed-returns-route-mismatched",
            "return-dashboard-initial-scan",
            "no-return-dashboard-candidate",
          ],
          safeMessage: "Synthetic Return Dashboard navigation failure.",
        },
      },
      deps,
      true,
    );

    expect(response).toMatchObject({
      flowSummary: {
        status: "blocked",
        flowStep: {
          safeSignals: [
            "gstr1-filed-returns-route-mismatched",
            "return-dashboard-initial-scan",
            "no-return-dashboard-candidate",
          ],
        },
      },
    });
    expect(storage.session[COMPLETION_KEY]).toBeDefined();
  });

  it("persists a popup-readable GSTR-3B Returns Dashboard preflight block", async () => {
    const response = await withPersistedSinglePeriodSummary(
      {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-3B",
      },
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "blocked",
          safeSignals: [
            "wrong-origin-open-returns-dashboard",
            "returns-dashboard-anchor-ambiguous",
          ],
          safeMessage: "Synthetic Returns Dashboard preflight block.",
        },
      },
      deps,
      true,
    );

    expect(response).toMatchObject({
      flowSummary: {
        status: "blocked",
        flowStep: {
          safeSignals: [
            "wrong-origin-open-returns-dashboard",
            "returns-dashboard-anchor-ambiguous",
          ],
        },
      },
    });
    expect(storage.session[COMPLETION_KEY]).toBeDefined();
  });

  it("persists a popup-readable final GSTR-2B capture rejection", async () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-2B" as const,
    };
    const response = await withPersistedSinglePeriodSummary(
      scope,
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: filedReturnsScopeId(scope.returnType),
          state: "blocked",
          safeSignals: ["gstr2b-capture-control-not-actionable"],
          safeMessage: "Pack could not verify the selected GSTR-2B download action.",
        },
      },
      deps,
      true,
    );

    expect(response).toHaveProperty("flowSummary.flowStep.safeSignals", [
      "gstr2b-capture-control-not-actionable",
    ]);
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      flowStep: { safeSignals: ["gstr2b-capture-control-not-actionable"] },
    });
  });

  it("allows only scoped captured-download start signals at the durable boundary", () => {
    expect(isDurableFiledReturnsSignal("filed-gstr1-extension-download-started")).toBe(true);
    expect(isDurableFiledReturnsSignal("filed-gstr2b-extension-download-started")).toBe(true);
    expect(isDurableFiledReturnsSignal("filed-gstr3b-extension-download-started")).toBe(true);
    expect(isDurableFiledReturnsSignal("synthetic-extension-download-started")).toBe(false);
  });

  it.each(
    FILED_RETURNS_RETURN_TYPES.flatMap((returnType) =>
      (Object.keys(ARTIFACT_FAILURE_MESSAGES) as ArtifactFailureReason[]).map(
        (reason) => [returnType, reason] as const,
      ),
    ),
  )(
    "persists a popup-readable terminal message for every %s %s artifact failure",
    async (returnType, reason) => {
      const scope = {
        artifactType: "PDF" as const,
        financialYear: "2025-26",
        period: "March" as const,
        returnType,
      };
      const response = await withPersistedSinglePeriodSummary(
        scope,
        {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: filedReturnsScopeId(returnType),
            state: "blocked",
            safeSignals: ["artifact-acquisition-failed", `artifact-${reason}`],
            safeMessage: ARTIFACT_FAILURE_MESSAGES[reason],
          },
        },
        deps,
        true,
      );

      expect(response).toHaveProperty(
        "flowSummary.flowStep.safeMessage",
        expect.stringMatching(/\S/),
      );
      await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
        flowStep: { safeMessage: expect.stringMatching(/\S/) },
      });
    },
  );

  it.each(Object.values(Gstr2bArtifactDispatchFailureReason))(
    "persists a popup-readable terminal message for GSTR-2B %s",
    async (reason) => {
      const scope = {
        artifactType: "PDF" as const,
        financialYear: "2025-26",
        period: "March" as const,
        returnType: "GSTR-2B" as const,
      };
      const response = await withPersistedSinglePeriodSummary(
        scope,
        {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: filedReturnsScopeId(scope.returnType),
            state: "blocked",
            safeSignals: [reason],
            safeMessage: GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES[reason],
          },
        },
        deps,
        true,
      );

      expect(response).toHaveProperty(
        "flowSummary.flowStep.safeMessage",
        expect.stringMatching(/\S/),
      );
      await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
        flowStep: { safeMessage: expect.stringMatching(/\S/) },
      });
    },
  );

  it("canonicalizes provided single-period and full-year summary writes", async () => {
    const response = await withPersistedSinglePeriodSummary(
      {
        financialYear: "2025-26",
        period: "March",
        returnType: "GSTR-3B",
      },
      {
        ok: true,
        flowStep: singlePeriodSummary().flowStep,
        flowSummary: singlePeriodSummary(),
      },
      deps,
      true,
    );

    expect(response).toHaveProperty(
      "flowSummary.flowStep.safeMessage",
      "Pack needs an explicit recovery action before continuing March.",
    );
    expect(JSON.stringify(storage.session[COMPLETION_KEY])).not.toContain("Synthetic Taxpayer Co.");

    await persistSummary(deps, singlePeriodSummary());
    expect(storage.session[COMPLETION_KEY]).toHaveProperty(
      "flowStep.safeMessage",
      "Pack needs an explicit recovery action before continuing March.",
    );
  });

  it("retains fixed full-year summary status through canonical persistence and reopen", async () => {
    const summaryWithDiagnostic = fullFiscalYearSummaryWithCurrentPeriodDiagnostic("March");
    const { downloadDiagnostic: _discardedDiagnostic, ...flowStep } =
      summaryWithDiagnostic.flowStep;
    void _discardedDiagnostic;
    const summary = {
      ...summaryWithDiagnostic,
      flowStep: {
        ...flowStep,
        safeSignals: [
          "full-fiscal-year-summary-included",
          "full-fiscal-year-summary-parsed-period-count:1",
          "full-fiscal-year-summary-row-count:12",
        ],
      },
    };

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      flowStep: {
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-summary-included",
          "full-fiscal-year-summary-parsed-period-count:1",
          "full-fiscal-year-summary-row-count:12",
        ]),
        safeMessage: expect.not.stringContaining("Synthetic supplied portal prose"),
      },
    });
  });

  it("reconstructs a timestamped summary when a provided envelope is incomplete", async () => {
    const provided = singlePeriodSummary();
    delete provided.updatedAt;
    const response = await withPersistedSinglePeriodSummary(
      provided.scope,
      {
        ok: true,
        flowStep: provided.flowStep,
        flowSummary: provided,
      },
      { ...deps, now: () => new Date("2026-07-24T00:00:00.000Z") },
      true,
    );

    expect(response).toHaveProperty("flowSummary.updatedAt", "2026-07-24T00:00:00.000Z");
    expect(storage.session[COMPLETION_KEY]).toHaveProperty(
      "flowStep.safeMessage",
      "Pack needs an explicit recovery action before continuing March.",
    );
  });

  it("binds full-year diagnostics to the explicit current period", async () => {
    const summary = fullFiscalYearSummaryWithCurrentPeriodDiagnostic("March");

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    expect(storage.session[COMPLETION_KEY]).toHaveProperty(
      "flowStep.downloadDiagnostic.period",
      "March",
    );

    await expect(
      persistCanonicalFiledReturnsFlowSummary(
        COMPLETION_KEY,
        fullFiscalYearSummaryWithCurrentPeriodDiagnostic("May"),
      ),
    ).resolves.toBeNull();
    expect(storage.session[COMPLETION_KEY]).toBeUndefined();
  });

  it("rejects a single-period ledger ID in full-year recovery state", async () => {
    const summary = {
      ...fullFiscalYearSummaryWithCurrentPeriodDiagnostic("March"),
      fullFiscalYearRecovery: {
        expectedRevision: 2,
        ledgerId: "single-period:12345678-wrong",
        targetId: "GSTR-3B:2025-26:March",
        targetStatus: "blocked",
      },
    };

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.toBeNull();
    expect(storage.session[COMPLETION_KEY]).toBeUndefined();
  });

  it("accepts single-period completion only with exact positive download evidence", async () => {
    const directOpfsOnly = completeSinglePeriodSummary({
      flowStep: {
        downloadDiagnostic: {
          ...completeSinglePeriodSummary().flowStep.downloadDiagnostic,
          downloadId: undefined,
        },
      },
    });
    directOpfsOnly.flowStep.safeSignals.push("single-period-opfs-staged:PDF");

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, completeSinglePeriodSummary()),
    ).resolves.not.toBeNull();

    for (const summary of [
      completeSinglePeriodSummary({ flowStep: { downloadDiagnostic: undefined } }),
      completeSinglePeriodSummary({ completedPeriods: [] }),
      completeSinglePeriodSummary({ currentPeriod: undefined }),
      completeSinglePeriodSummary({ flowStep: { state: "blocked" } }),
      directOpfsOnly,
    ]) {
      await expect(
        persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
      ).resolves.toBeNull();
    }
  });

  it("requires the completed ZIP signal for a staged multi-artifact selection", async () => {
    await expect(
      persistCanonicalFiledReturnsFlowSummary(
        COMPLETION_KEY,
        completeSelectedArtifactBundleSummary(true),
      ),
    ).resolves.not.toBeNull();
    await expect(
      persistCanonicalFiledReturnsFlowSummary(
        COMPLETION_KEY,
        completeSelectedArtifactBundleSummary(false),
      ),
    ).resolves.toBeNull();
  });

  it.each([
    [
      "download-filename-unavailable",
      "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
    ],
    [
      "download-filename-overridden",
      "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
    ],
  ])(
    "retains direct-download filename outcome %s through canonical persistence and reopen",
    async (signal, warning) => {
      const base = completeSinglePeriodSummary();
      const summary = completeSinglePeriodSummary({
        flowStep: {
          safeSignals: [...base.flowStep.safeSignals, signal],
        },
      });

      await expect(
        persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
      ).resolves.not.toBeNull();
      await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
        status: "complete",
        flowStep: {
          state: "downloaded",
          safeSignals: expect.arrayContaining([signal]),
          safeMessage: `Pack completed the local filed-return download for March. ${warning}`,
        },
      });
    },
  );

  const confirmedPartialZipSignals = [
    "single-period-zip-downloaded",
    "browser-download-completed",
    "browser-download-non-empty",
    "browser-download-id:81",
  ];
  describe.each([
    ["confirmed", confirmedPartialZipSignals, true],
    ["legacy ZIP signal only", ["single-period-zip-downloaded"], false],
    ["no ZIP evidence", [], false],
    ["missing ZIP signal", confirmedPartialZipSignals.slice(1), false],
    [
      "missing ID",
      confirmedPartialZipSignals.filter((signal) => !signal.startsWith("browser-download-id:")),
      false,
    ],
    [
      "missing completion",
      confirmedPartialZipSignals.filter((signal) => signal !== "browser-download-completed"),
      false,
    ],
    [
      "missing non-empty proof",
      confirmedPartialZipSignals.filter((signal) => signal !== "browser-download-non-empty"),
      false,
    ],
    ["multiple IDs", [...confirmedPartialZipSignals, "browser-download-id:82"], false],
    [
      "contradictory evidence",
      [...confirmedPartialZipSignals, "browser-download-correlation-rejected"],
      false,
    ],
  ] as const)("partial ZIP filename evidence: %s", (_name, evidence, confirmed) => {
    it.each([
      [
        "zip-download-filename-unavailable",
        "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
        "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
      ],
      [
        "zip-download-filename-overridden",
        "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
        "The browser may have used a different saved name, but Pack could not verify that any file belongs to this unresolved target. Check browser Downloads before using a file.",
      ],
    ])(
      "retains partial ZIP reason and %s after reopen",
      async (signal, confirmedCopy, neutralCopy) => {
        const base = partialSelectedArtifactBundleSummary(signal);
        const summary = {
          ...base,
          flowStep: {
            ...base.flowStep,
            safeSignals: [
              ...base.flowStep.safeSignals.filter(
                (value) => value !== "single-period-zip-downloaded",
              ),
              ...evidence,
            ],
          },
        };

        await expect(
          persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
        ).resolves.not.toBeNull();
        await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
          status: "partial",
          completedPeriods: [],
          flowStep: {
            state: "partial",
            safeSignals: summary.flowStep.safeSignals,
            safeMessage: `Pack prepared a partial ZIP; missing EXCEL (artifact-generation-timeout). ${confirmed ? confirmedCopy : neutralCopy}`,
            downloadDiagnostics: summary.flowStep.downloadDiagnostics,
          },
        });
      },
    );
  });

  describe.each([
    [
      "single-period status alone",
      "March",
      [],
      "Pack retained verified artifact progress for March; the selection is not complete.",
    ],
    [
      "full-year status alone",
      "FULL_FISCAL_YEAR",
      [],
      "Pack retained verified artifact progress for the saved fiscal-year run; the selection is not complete.",
    ],
    [
      "full-year scope with foreign single-period evidence",
      "FULL_FISCAL_YEAR",
      confirmedPartialZipSignals,
      "Pack retained verified artifact progress for the saved fiscal-year run; the selection is not complete.",
    ],
    [
      "single-period unresolved portal key with delivery signals",
      "March",
      [...confirmedPartialZipSignals, "portal-system-error"],
      "The GST portal returned a system-error page. Return to an authenticated GST page and retry this period.",
    ],
  ] as const)("unresolved partial filename context: %s", (_name, period, signals, baseCopy) => {
    it.each([
      [
        "download-filename-overridden",
        "The browser may have used a different saved name, but Pack could not verify that any file belongs to this unresolved target. Check browser Downloads before using a file.",
      ],
      [
        "download-filename-unavailable",
        "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
      ],
    ])("keeps %s neutral after reopen", async (filenameSignal, neutralCopy) => {
      const safeSignals = [...signals, filenameSignal];
      const base = singlePeriodSummary({ safeSignals, state: "partial" });
      const summary = { ...base, status: "partial", scope: { ...base.scope, period } };

      await expect(
        persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
      ).resolves.not.toBeNull();
      await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
        scope: summary.scope,
        status: "partial",
        completedPeriods: [],
        flowStep: {
          state: "partial",
          safeSignals,
          safeMessage: `${baseCopy} ${neutralCopy}`,
        },
      });
    });
  });

  it.each([
    [
      "zip-download-filename-item-unavailable",
      "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
    ],
    [
      "zip-download-filename-search-unavailable",
      "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
    ],
    [
      "zip-download-filename-unavailable",
      "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
    ],
    [
      "zip-download-filename-overridden",
      "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
    ],
  ])(
    "retains completed ZIP reason %s and its warning through canonical persistence and reopen",
    async (signal, warning) => {
      const base = completeSelectedArtifactBundleSummary(true);
      const summary = {
        ...base,
        flowStep: {
          ...base.flowStep,
          safeSignals: [...base.flowStep.safeSignals, signal],
        },
      };

      await expect(
        persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
      ).resolves.not.toBeNull();
      await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
        status: "complete",
        flowStep: {
          state: "downloaded",
          safeSignals: expect.arrayContaining([signal]),
          safeMessage: `Pack completed the local filed-return download for May. ${warning}`,
        },
      });
    },
  );

  it("accepts positive not-filed completion only without download diagnostics", async () => {
    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, completeNotFiledSummary()),
    ).resolves.not.toBeNull();
    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, {
        ...completeNotFiledSummary(),
        flowStep: {
          ...completeNotFiledSummary().flowStep,
          downloadDiagnostic: completeSinglePeriodSummary().flowStep.downloadDiagnostic,
        },
      }),
    ).resolves.toBeNull();
  });

  it.each([
    "download-filename-overridden",
    "download-filename-unavailable",
    "zip-download-filename-overridden",
    "zip-download-filename-unavailable",
    "zip-download-filename-item-unavailable",
    "zip-download-filename-search-unavailable",
  ])("does not let filename signal %s claim a not-filed download", async (signal) => {
    const base = completeNotFiledSummary();
    const summary = {
      ...base,
      flowStep: {
        ...base.flowStep,
        safeSignals: [...base.flowStep.safeSignals, signal],
      },
    };

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "complete",
      completedPeriods: ["March"],
      flowStep: {
        state: "candidate-not-found",
        safeSignals: expect.arrayContaining(["filed-return-positively-not-filed", signal]),
        safeMessage: "The GST Portal reported no filed return for the selected period.",
      },
    });
  });

  it("accepts full-year completion only as a terminal aggregate", async () => {
    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, completeFullFiscalYearSummary()),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "complete",
      flowStep: {
        state: "downloaded",
        safeMessage:
          "Pack completed the saved fiscal-year run, but could not confirm a final ZIP download. Check browser Downloads before relying on a file.",
        safeSignals: ["full-fiscal-year-complete"],
      },
    });

    for (const summary of [
      completeFullFiscalYearSummary({ currentPeriod: "May" }),
      completeFullFiscalYearSummary({ completedPeriods: ["April"] }),
      completeFullFiscalYearSummary({ flowStep: { safeSignals: ["browser-download-completed"] } }),
    ]) {
      await expect(
        persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
      ).resolves.toBeNull();
    }
  });

  it("does not let a filename outcome supply missing full-year delivery proof", async () => {
    const base = completeFullFiscalYearSummary();
    const summary = completeFullFiscalYearSummary({
      flowStep: {
        safeSignals: [...base.flowStep.safeSignals, "zip-download-filename-overridden"],
      },
    });

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "complete",
      flowStep: {
        state: "downloaded",
        safeMessage:
          "Pack completed the saved fiscal-year run, but could not confirm a final ZIP download. Check browser Downloads before relying on a file.",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-complete",
          "zip-download-filename-overridden",
        ]),
      },
    });
  });

  it("does not let a full-year signal relabel a completed single-period download", async () => {
    const base = completeSinglePeriodSummary();
    const summary = completeSinglePeriodSummary({
      flowStep: {
        safeSignals: [
          ...base.flowStep.safeSignals,
          "full-fiscal-year-complete",
          "download-filename-overridden",
        ],
      },
    });

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "complete",
      flowStep: {
        state: "downloaded",
        safeMessage:
          "Pack completed the local filed-return download for March. Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-complete",
          "download-filename-overridden",
        ]),
      },
    });
  });

  it.each([
    "full-fiscal-year-resume-confirmation-required",
    "full-fiscal-year-run-interrupted",
    "full-fiscal-year-run-active",
    "full-fiscal-year-zip-download-unconfirmed",
  ])("does not let cross-scope %s relabel a blocked single-period summary", async (signal) => {
    const summary = singlePeriodSummary({ safeSignals: [signal] });

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "blocked",
      flowStep: {
        state: "blocked",
        safeMessage: "Pack needs an explicit recovery action before continuing March.",
        safeSignals: [signal],
      },
    });
  });

  const confirmedSinglePeriodCleanupSignals = [
    "single-period-opfs-clear-failed",
    "single-period-zip-downloaded",
    "browser-download-completed",
    "browser-download-non-empty",
    "browser-download-id:81",
  ];
  describe.each([
    [
      "full-year delivered",
      "FULL_FISCAL_YEAR",
      ["full-fiscal-year-opfs-clear-failed", "full-fiscal-year-zip-downloaded"],
      "full-year",
    ],
    ["full-year unconfirmed", "FULL_FISCAL_YEAR", ["full-fiscal-year-opfs-clear-failed"], "none"],
    ["single-period delivered", "March", confirmedSinglePeriodCleanupSignals, "single-period"],
    [
      "missing ID",
      "March",
      confirmedSinglePeriodCleanupSignals.filter(
        (signal) => !signal.startsWith("browser-download-id:"),
      ),
      "none",
    ],
    [
      "missing completion",
      "March",
      confirmedSinglePeriodCleanupSignals.filter(
        (signal) => signal !== "browser-download-completed",
      ),
      "none",
    ],
    [
      "missing non-empty proof",
      "March",
      confirmedSinglePeriodCleanupSignals.filter(
        (signal) => signal !== "browser-download-non-empty",
      ),
      "none",
    ],
    [
      "multiple IDs",
      "March",
      [...confirmedSinglePeriodCleanupSignals, "browser-download-id:82"],
      "none",
    ],
    [
      "contradictory evidence",
      "March",
      [...confirmedSinglePeriodCleanupSignals, "browser-download-correlation-rejected"],
      "none",
    ],
    [
      "foreign full-year delivery",
      "March",
      ["single-period-opfs-clear-failed", "full-fiscal-year-zip-downloaded"],
      "none",
    ],
  ] as const)("blocked cleanup filename context: %s", (_name, period, signals, confirmed) => {
    it.each([
      [
        "download-filename-overridden",
        "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
        "The browser may have used a different saved name, but Pack could not verify that any file belongs to this unresolved target. Check browser Downloads before using a file.",
      ],
      [
        "download-filename-unavailable",
        "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
        "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.",
      ],
    ])(
      "preserves %s according to canonical delivery classification",
      async (filenameSignal, confirmedCopy, neutralCopy) => {
        const safeSignals = [...signals, filenameSignal];
        const base = singlePeriodSummary({ safeSignals });
        const summary = { ...base, scope: { ...base.scope, period } };
        const baseCopy =
          confirmed === "full-year"
            ? "Pack confirmed the final fiscal-year ZIP download; only retained local staging remains to be cleared."
            : confirmed === "single-period"
              ? "Pack confirmed the selected ZIP download for March; only temporary local staging remains to be cleared."
              : "Pack cannot complete this review while temporary selected-file staging remains uncleared.";

        await expect(
          persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
        ).resolves.not.toBeNull();
        await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
          scope: summary.scope,
          status: "blocked",
          currentPeriod: "March",
          completedPeriods: [],
          flowStep: {
            state: "blocked",
            safeSignals,
            safeMessage: `${baseCopy} ${confirmed === "none" ? neutralCopy : confirmedCopy}`,
            userAction: {
              type: "LOGIN",
              message: "Sign in to the GST Portal, then retry.",
              canResume: false,
            },
          },
        });
      },
    );
  });

  it("does not let cross-scope ZIP delivery relabel single-period cleanup", async () => {
    const summary = singlePeriodSummary({
      safeSignals: ["single-period-opfs-clear-failed", "full-fiscal-year-zip-downloaded"],
    });

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "blocked",
      flowStep: {
        state: "blocked",
        safeMessage:
          "Pack cannot complete this review while temporary selected-file staging remains uncleared.",
        safeSignals: ["single-period-opfs-clear-failed", "full-fiscal-year-zip-downloaded"],
      },
    });
  });

  it.each([
    ["portal-system-error", FILED_RETURNS_PORTAL_SYSTEM_ERROR_MESSAGE],
    ["portal-scheduled-downtime", FILED_RETURNS_PORTAL_SCHEDULED_DOWNTIME_MESSAGE],
    ["portal-blocked-or-session-expired", FILED_RETURNS_PORTAL_BLOCKED_OR_SESSION_EXPIRED_MESSAGE],
  ])("reopens a single-period %s with its fixed portal cause", async (signal, safeMessage) => {
    const summary = singlePeriodSummary({ safeSignals: [signal] });

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "blocked",
      flowStep: {
        state: "blocked",
        safeMessage,
        safeSignals: [signal],
      },
    });
  });

  it("reopens a confirmed fiscal-year ZIP as complete instead of download-unconfirmed", async () => {
    const base = completeFullFiscalYearSummary();
    const summary = completeFullFiscalYearSummary({
      flowStep: {
        safeSignals: [
          ...base.flowStep.safeSignals,
          "full-fiscal-year-zip-downloaded",
          "full-fiscal-year-opfs-cleared",
        ],
      },
    });

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "complete",
      flowStep: {
        state: "downloaded",
        safeMessage:
          "Pack completed the local filed-return download for the saved fiscal-year run.",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-complete",
          "full-fiscal-year-zip-downloaded",
        ]),
      },
    });
  });

  it("reopens a completed no-artifacts fiscal-year run without claiming a ZIP download", async () => {
    const base = completeFullFiscalYearSummary();
    const summary = completeFullFiscalYearSummary({
      flowStep: {
        safeSignals: [
          ...base.flowStep.safeSignals,
          "full-fiscal-year-no-zip-artifacts",
          "full-fiscal-year-opfs-cleared",
        ],
      },
    });

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "complete",
      flowStep: {
        state: "downloaded",
        safeMessage:
          "Pack completed the saved fiscal-year run. No ZIP was created because no filed-return artifacts were available for export.",
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-complete",
          "full-fiscal-year-no-zip-artifacts",
        ]),
      },
    });
  });

  it.each(["zip-download-filename-overridden", "zip-download-filename-unavailable"])(
    "does not let no-artifacts plus %s claim a download",
    async (filenameSignal) => {
      const base = completeFullFiscalYearSummary();
      const summary = completeFullFiscalYearSummary({
        flowStep: {
          safeSignals: [
            ...base.flowStep.safeSignals,
            "full-fiscal-year-no-zip-artifacts",
            "full-fiscal-year-opfs-cleared",
            filenameSignal,
          ],
        },
      });

      await expect(
        persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
      ).resolves.not.toBeNull();
      await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
        status: "complete",
        flowStep: {
          state: "downloaded",
          safeMessage:
            "Pack completed the saved fiscal-year run. No ZIP was created because no filed-return artifacts were available for export.",
          safeSignals: expect.arrayContaining([
            "full-fiscal-year-complete",
            "full-fiscal-year-no-zip-artifacts",
            filenameSignal,
          ]),
        },
      });
    },
  );

  it.each([
    ["portal-system-error", FILED_RETURNS_PORTAL_SYSTEM_ERROR_MESSAGE],
    ["portal-scheduled-downtime", FILED_RETURNS_PORTAL_SCHEDULED_DOWNTIME_MESSAGE],
    ["portal-blocked-or-session-expired", FILED_RETURNS_PORTAL_BLOCKED_OR_SESSION_EXPIRED_MESSAGE],
  ])("reopens a full-year %s with its fixed portal cause", async (signal, safeMessage) => {
    const summary = completeFullFiscalYearSummary({
      completedAt: undefined,
      status: "partial",
      updatedAt: "2026-07-24T00:00:00.000Z",
      flowStep: {
        state: "blocked",
        safeSignals: ["full-fiscal-year-run-needs-action", signal],
        userAction: {
          type: "WAIT_FOR_PORTAL_AVAILABILITY",
          message: "Synthetic supplied portal instruction.",
          canResume: true,
        },
      },
    });

    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
    ).resolves.not.toBeNull();
    await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
      status: "partial",
      flowStep: {
        state: "blocked",
        safeMessage,
        safeSignals: expect.arrayContaining(["full-fiscal-year-run-needs-action", signal]),
      },
    });
  });

  it.each([
    [
      "cleanup failure",
      "full-fiscal-year-opfs-clear-failed",
      "Pack cannot complete this review while temporary selected-file staging remains uncleared.",
    ],
    [
      "unconfirmed ZIP download",
      "full-fiscal-year-zip-download-unconfirmed",
      "Pack could not confirm the final fiscal-year ZIP. Check the exact browser download before retrying.",
    ],
    [
      "target review",
      "filed-returns-target-review-required",
      "Pack could not verify the browser download for the saved fiscal-year run. Check Downloads before retrying or cancelling this target.",
    ],
  ])(
    "keeps %s ahead of a retained portal cause after full-year reopen",
    async (_case, strongerSignal, safeMessage) => {
      const summary = completeFullFiscalYearSummary({
        completedAt: undefined,
        status: "partial",
        updatedAt: "2026-07-24T00:00:00.000Z",
        flowStep: {
          state: "blocked",
          safeSignals: ["full-fiscal-year-run-needs-action", "portal-system-error", strongerSignal],
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message: "Synthetic supplied recovery instruction.",
            canResume: true,
          },
        },
      });

      await expect(
        persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, summary),
      ).resolves.not.toBeNull();
      await expect(readCanonicalFiledReturnsFlowSummary(COMPLETION_KEY)).resolves.toMatchObject({
        status: "partial",
        flowStep: {
          state: "blocked",
          safeMessage,
          safeSignals: expect.arrayContaining([
            "full-fiscal-year-run-needs-action",
            "portal-system-error",
            strongerSignal,
          ]),
        },
      });
    },
  );

  it("canonicalizes observations persisted from flow responses", async () => {
    await persistFlowResponse(
      {
        ok: true,
        observation: {
          connectorId: "gst",
          pageKind: "gst-filed-returns",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "login-required",
          safeSignals: ["login"],
          safeMessage: "Synthetic Taxpayer Co. confidential note.",
          userAction: {
            type: "LOGIN",
            message: "Synthetic account-specific instruction.",
            canResume: false,
          },
        },
      },
      deps,
    );

    expect(storage.session[OBSERVATION_KEY]).toMatchObject({
      safeMessage: "Sign in to the GST Portal, then reopen Pack.",
      userAction: {
        type: "LOGIN",
        message: "Sign in to the GST Portal in this browser tab, then reopen Pack.",
        canResume: true,
      },
    });
    expect(JSON.stringify(storage.session[OBSERVATION_KEY])).not.toContain(
      "Synthetic Taxpayer Co.",
    );
  });
});

function singlePeriodSummary(
  flowStepOverrides: Record<string, unknown> = {},
): FiledReturnsFlowSummary {
  return {
    scope: { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
    status: "blocked",
    updatedAt: "2026-06-24T00:00:00.000Z",
    completedPeriods: [],
    currentPeriod: "March",
    totalPeriods: 1,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "blocked",
      safeSignals: ["browser-download-not-observed"],
      safeMessage: "Synthetic Taxpayer Co. confidential note.",
      userAction: {
        type: "LOGIN",
        message: "Synthetic account-specific instruction.",
        canResume: false,
      },
      ...flowStepOverrides,
    },
  };
}

function fullFiscalYearSummaryWithCurrentPeriodDiagnostic(diagnosticPeriod: string) {
  return {
    scope: {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "FULL_FISCAL_YEAR",
      returnType: "GSTR-3B",
    },
    status: "blocked",
    updatedAt: "2026-06-24T00:00:00.000Z",
    completedPeriods: [],
    currentPeriod: "March",
    totalPeriods: 12,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "blocked",
      safeSignals: ["browser-download-not-observed"],
      safeMessage: "Synthetic supplied portal prose.",
      downloadDiagnostic: {
        schemaVersion: "1.0",
        eventType: "filed-return-download-path",
        actionId: "action-12345678-test",
        artifactType: "PDF",
        downloadPathClass: "captured-portal-request-unknown",
        endpointClass: "gstr3b-portal-blob-captured-download",
        errorCategory: "browser-download-not-observed",
        financialYear: "2025-26",
        period: diagnosticPeriod,
        returnType: "GSTR-3B",
        status: "blocked",
      },
    },
  };
}

function completeSinglePeriodSummary(overrides: Record<string, unknown> = {}) {
  const base = {
    scope: { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
    status: "complete",
    completedAt: "2026-07-24T00:00:00.000Z",
    completedPeriods: ["March"],
    currentPeriod: "March",
    totalPeriods: 1,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals: [
        "browser-download-completed",
        "browser-download-non-empty",
        "filed-return-artifact-downloaded:PDF",
      ],
      safeMessage: "Synthetic supplied portal prose.",
      downloadDiagnostic: {
        schemaVersion: "1.0",
        eventType: "filed-return-download-path",
        actionId: "action-12345678-test",
        artifactType: "PDF",
        byteCountClass: "non-empty",
        downloadId: 81,
        downloadPathClass: "captured-portal-request-https",
        endpointClass: "gstr3b-portal-blob-captured-download",
        financialYear: "2025-26",
        mimeClass: "pdf",
        period: "March",
        returnType: "GSTR-3B",
        status: "downloaded",
      },
    },
  };
  const flowStepOverride = overrides.flowStep as Record<string, unknown> | undefined;
  return {
    ...base,
    ...overrides,
    flowStep: { ...base.flowStep, ...flowStepOverride },
  };
}

function completeFullFiscalYearSummary(overrides: Record<string, unknown> = {}) {
  const base = {
    scope: {
      financialYear: "2025-26",
      period: "FULL_FISCAL_YEAR",
      returnType: "GSTR-3B",
    },
    status: "complete",
    completedAt: "2026-07-24T00:00:00.000Z",
    completedPeriods: ["April", "May"],
    totalPeriods: 2,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Synthetic supplied portal prose.",
    },
  };
  const flowStepOverride = overrides.flowStep as Record<string, unknown> | undefined;
  return {
    ...base,
    ...overrides,
    flowStep: { ...base.flowStep, ...flowStepOverride },
  };
}

function completeSelectedArtifactBundleSummary(includeZipSignal: boolean) {
  const diagnostics = [
    selectedArtifactDiagnostic("PDF", "action-12345678-pdf"),
    selectedArtifactDiagnostic("EXCEL", "action-12345678-excel"),
    selectedArtifactDiagnostic("JSON", "action-12345678-json"),
  ];
  return {
    scope: {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    },
    status: "complete",
    completedAt: "2026-07-24T00:00:00.000Z",
    completedPeriods: ["May"],
    currentPeriod: "May",
    totalPeriods: 1,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-gstr2b-private-v0",
      state: "downloaded",
      safeSignals: [
        "filed-return-artifact-downloaded:PDF",
        "single-period-opfs-staged:PDF",
        "filed-return-artifact-downloaded:EXCEL",
        "single-period-opfs-staged:EXCEL",
        "filed-return-artifact-downloaded:JSON",
        "single-period-opfs-staged:JSON",
        ...(includeZipSignal ? ["single-period-zip-downloaded"] : []),
      ],
      safeMessage: "Synthetic supplied portal prose.",
      downloadDiagnostic: diagnostics.at(-1),
      downloadDiagnostics: diagnostics,
    },
  };
}

function partialSelectedArtifactBundleSummary(filenameSignal: string) {
  const diagnostics = [
    selectedArtifactDiagnostic("PDF", "action-12345678-pdf"),
    selectedArtifactDiagnostic("JSON", "action-12345678-json"),
  ];
  return {
    scope: {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B" as const,
    },
    status: "partial" as const,
    updatedAt: "2026-07-24T00:00:00.000Z",
    completedPeriods: [],
    currentPeriod: "May",
    totalPeriods: 1,
    flowStep: {
      connectorId: "gst" as const,
      scopeId: "gst-gstr2b-private-v0",
      state: "partial" as const,
      safeSignals: [
        "filed-return-artifact-downloaded:PDF",
        "single-period-opfs-staged:PDF",
        "filed-return-artifact-downloaded:JSON",
        "single-period-opfs-staged:JSON",
        "filed-return-artifact-unavailable:EXCEL",
        "artifact-generation-timeout",
        "single-period-zip-downloaded",
        filenameSignal,
      ],
      safeMessage: "Synthetic supplied portal prose.",
      downloadDiagnostic: diagnostics.at(-1),
      downloadDiagnostics: diagnostics,
    },
  };
}

function selectedArtifactDiagnostic(artifactType: "PDF" | "EXCEL" | "JSON", actionId: string) {
  return {
    schemaVersion: "1.0",
    eventType: "filed-return-download-path",
    actionId,
    artifactType,
    byteCountClass: "non-empty",
    downloadPathClass: "captured-portal-request-data",
    endpointClass:
      artifactType === "JSON"
        ? "gstr2b-main-world-json-captured-download"
        : "gstr2b-portal-blob-captured-download",
    financialYear: "2025-26",
    mimeClass: artifactType === "PDF" ? "pdf" : artifactType === "JSON" ? "json" : "spreadsheet",
    period: "May",
    returnType: "GSTR-2B",
    status: "downloaded",
  };
}

function completeNotFiledSummary() {
  return {
    scope: { financialYear: "2025-26", period: "March", returnType: "GSTR-3B" },
    status: "complete",
    completedAt: "2026-07-24T00:00:00.000Z",
    completedPeriods: ["March"],
    currentPeriod: "March",
    totalPeriods: 1,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "candidate-not-found",
      safeSignals: ["filed-return-positively-not-filed"],
      safeMessage: "Synthetic supplied portal prose.",
    },
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import { persistFlowResponse } from "../../src/background/filed-returns-flow-runner-utils";
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

  it("accepts full-year completion only as a terminal aggregate", async () => {
    await expect(
      persistCanonicalFiledReturnsFlowSummary(COMPLETION_KEY, completeFullFiscalYearSummary()),
    ).resolves.not.toBeNull();

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

function selectedArtifactDiagnostic(artifactType: "PDF" | "EXCEL" | "JSON", actionId: string) {
  return {
    schemaVersion: "1.0",
    eventType: "filed-return-download-path",
    actionId,
    artifactType,
    byteCountClass: "non-empty",
    downloadPathClass: "captured-portal-request-data",
    endpointClass: "gstr2b-portal-blob-captured-download",
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
  clearLegacySinglePeriodStagingRecord,
  clearSinglePeriodBundleLedger,
  createSinglePeriodBundleLedger,
  markSinglePeriodBundleArtifactRunning,
  markSinglePeriodBundleArtifactStaged,
  markSinglePeriodBundleArtifactUnavailable,
  persistSinglePeriodBundleArtifactRunning,
  persistSinglePeriodBundleArtifactStaged,
  persistSinglePeriodBundleArtifactUnavailable,
  persistSinglePeriodBundleCleanupPending,
  persistSinglePeriodBundleZipDownloadId,
  persistSinglePeriodBundleZipIntent,
  readSinglePeriodBundleLedgerStorageState,
  reserveSinglePeriodBundleLedger,
  sameSinglePeriodBundleScope,
  singlePeriodBundleEntryPlan,
  singlePeriodBundleFlowStep,
} from "../../src/background/filed-returns-single-period-bundle-ledger";

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(),
      remove: vi.fn(),
      set: vi.fn(),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

const STORAGE_KEY = "pack:single-period-staging";
const GSTR2B_SCOPE = {
  artifactType: "PDF_AND_EXCEL",
  financialYear: "2026-27",
  period: "April",
  returnType: "GSTR-2B",
} as const satisfies FiledReturnsDownloadScope;
const CREATED_AT = new Date("2026-07-24T00:00:00.000Z");
const PDF_RUNNING_AT = new Date("2026-07-24T00:00:01.000Z");
const PDF_STAGED_AT = new Date("2026-07-24T00:00:02.000Z");
const EXCEL_RUNNING_AT = new Date("2026-07-24T00:00:03.000Z");
const EXCEL_STAGED_AT = new Date("2026-07-24T00:00:04.000Z");

let localValues: Record<string, unknown>;

describe("single-period bundle ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localValues = {};
    browserMocks.storage.local.get.mockImplementation(async (key: string) =>
      Object.hasOwn(localValues, key) ? { [key]: localValues[key] } : {},
    );
    browserMocks.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(localValues, values);
    });
    browserMocks.storage.local.remove.mockImplementation(async (key: string) => {
      delete localValues[key];
    });
  });

  it("persists a versioned, scope-bound ordered bundle intent", async () => {
    const reservation = await reserveSinglePeriodBundleLedger(GSTR2B_SCOPE, CREATED_AT);

    expect(reservation).toMatchObject({
      state: "created",
      ledger: {
        artifactPlan: ["PDF", "EXCEL"],
        phase: "collecting",
        revision: 1,
        schemaVersion: "1.0",
        scope: GSTR2B_SCOPE,
        artifacts: [
          { artifactType: "PDF", status: "pending" },
          { artifactType: "EXCEL", status: "pending" },
        ],
      },
    });
    expect(await readSinglePeriodBundleLedgerStorageState()).toMatchObject({
      state: "valid",
      ledger: { revision: 1, scope: GSTR2B_SCOPE },
    });
    expect(JSON.stringify(localValues[STORAGE_KEY])).not.toMatch(
      /zipPath|filename|localPath|https?:|blob:|data:/i,
    );
    expect(
      createSinglePeriodBundleLedger(GSTR2B_SCOPE, "full-fiscal-year-abcd1234", CREATED_AT),
    ).toBeNull();
  });

  it("returns the saved ledger for a duplicate reservation without replacing its identity", async () => {
    const first = await reserveSinglePeriodBundleLedger(GSTR2B_SCOPE, CREATED_AT);
    const duplicate = await reserveSinglePeriodBundleLedger(
      GSTR2B_SCOPE,
      new Date("2026-07-24T00:01:00.000Z"),
    );

    expect(first?.state).toBe("created");
    if (!first || !("ledger" in first)) throw new Error("expected a created bundle ledger");
    expect(duplicate).toMatchObject({
      state: "existing",
      ledger: { ledgerId: first.ledger.ledgerId, revision: 1 },
    });
    expect(browserMocks.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it("fails closed on restart from running and never re-arms the same artifact", async () => {
    const ledger = requiredLedger();
    localValues[STORAGE_KEY] = ledger;
    const running = await persistSinglePeriodBundleArtifactRunning(ledger, "PDF", PDF_RUNNING_AT);

    expect(running).toMatchObject({
      phase: "collecting",
      revision: 2,
      artifacts: expect.arrayContaining([
        expect.objectContaining({ artifactType: "PDF", status: "running" }),
      ]),
    });
    const restarted = await readSinglePeriodBundleLedgerStorageState();
    expect(restarted).toMatchObject({
      state: "valid",
      ledger: {
        artifacts: expect.arrayContaining([
          expect.objectContaining({ artifactType: "PDF", status: "running" }),
        ]),
      },
    });
    expect(markSinglePeriodBundleArtifactRunning(running!, "PDF", PDF_STAGED_AT)).toBeNull();
    expect(
      await persistSinglePeriodBundleArtifactRunning(running!, "PDF", PDF_STAGED_AT),
    ).toBeNull();
  });

  it("resumes only the missing artifact after the first artifact is durably staged", async () => {
    const initial = requiredLedger();
    localValues[STORAGE_KEY] = initial;
    const pdfRunning = await persistSinglePeriodBundleArtifactRunning(
      initial,
      "PDF",
      PDF_RUNNING_AT,
    );
    const pdfStaged = await persistSinglePeriodBundleArtifactStaged(
      pdfRunning!,
      "PDF",
      stagedStep(GSTR2B_SCOPE, "PDF"),
      PDF_STAGED_AT,
    );

    expect(pdfStaged).toMatchObject({
      phase: "collecting",
      artifacts: [
        { artifactType: "PDF", status: "staged" },
        { artifactType: "EXCEL", status: "pending" },
      ],
    });
    expect(markSinglePeriodBundleArtifactRunning(pdfStaged!, "PDF", EXCEL_RUNNING_AT)).toBeNull();
    expect(
      markSinglePeriodBundleArtifactRunning(pdfStaged!, "EXCEL", EXCEL_RUNNING_AT),
    ).not.toBeNull();
    expect(singlePeriodBundleEntryPlan(pdfStaged!)).toBeNull();
  });

  it("persists both staged artifacts before exposing an exact ZIP slot plan", async () => {
    const ready = await persistBothArtifacts();

    expect(ready).toMatchObject({
      phase: "ready-for-zip",
      artifacts: [
        { artifactType: "PDF", status: "staged" },
        { artifactType: "EXCEL", status: "staged" },
      ],
    });
    expect(singlePeriodBundleEntryPlan(ready!)).toEqual({
      artifactTypes: ["PDF", "EXCEL"],
      unavailableArtifactTypes: [],
    });
  });

  it("emits a canonical return scope with deduplicated durable staging signals", async () => {
    const ready = await persistBothArtifacts();
    const flowStep = singlePeriodBundleFlowStep(ready!);

    expect(flowStep?.scopeId).toBe("gst-gstr2b-private-v0");
    expect(
      flowStep?.safeSignals.filter((signal) => signal === "single-period-opfs-staged"),
    ).toEqual(["single-period-opfs-staged"]);
    expect(new Set(flowStep?.safeSignals).size).toBe(flowStep?.safeSignals.length);
  });

  it("allows only policy-approved GSTR-1 Excel unavailability in the ZIP plan", async () => {
    const scope = { ...GSTR2B_SCOPE, returnType: "GSTR-1" as const };
    const initial = createSinglePeriodBundleLedger(
      scope,
      "single-period:12345678-gstr1",
      CREATED_AT,
    )!;
    localValues[STORAGE_KEY] = initial;
    const pdfRunning = await persistSinglePeriodBundleArtifactRunning(
      initial,
      "PDF",
      PDF_RUNNING_AT,
    );
    const pdfStaged = await persistSinglePeriodBundleArtifactStaged(
      pdfRunning!,
      "PDF",
      stagedStep(scope, "PDF"),
      PDF_STAGED_AT,
    );
    const excelRunning = await persistSinglePeriodBundleArtifactRunning(
      pdfStaged!,
      "EXCEL",
      EXCEL_RUNNING_AT,
    );
    const ready = await persistSinglePeriodBundleArtifactUnavailable(
      excelRunning!,
      "EXCEL",
      unavailableExcelStep(scope),
      EXCEL_STAGED_AT,
    );

    expect(ready?.phase).toBe("ready-for-zip");
    expect(singlePeriodBundleEntryPlan(ready!)).toEqual({
      artifactTypes: ["PDF"],
      unavailableArtifactTypes: ["EXCEL"],
    });
    expect(
      markSinglePeriodBundleArtifactUnavailable(
        { ...excelRunning!, scope: GSTR2B_SCOPE },
        "EXCEL",
        unavailableExcelStep(GSTR2B_SCOPE),
        EXCEL_STAGED_AT,
      ),
    ).toBeNull();
  });

  it("durably checkpoints final ZIP intent, exact ID, and cleanup without paths", async () => {
    const ready = await persistBothArtifacts();
    const intent = await persistSinglePeriodBundleZipIntent(
      ready!,
      new Date("2026-07-24T00:00:05.000Z"),
    );
    expect(await readSinglePeriodBundleLedgerStorageState()).toMatchObject({
      state: "valid",
      ledger: {
        phase: "zip-intent-persisted",
        zipDownloadAttempt: { requestedAt: "2026-07-24T00:00:05.000Z" },
      },
    });
    expect(intent?.zipDownloadAttempt).not.toHaveProperty("downloadId");

    const observing = await persistSinglePeriodBundleZipDownloadId(
      intent!,
      91,
      new Date("2026-07-24T00:00:06.000Z"),
    );
    expect(observing).toMatchObject({
      phase: "zip-observing",
      zipDownloadAttempt: { downloadId: 91 },
    });

    const cleanup = await persistSinglePeriodBundleCleanupPending(
      observing!,
      new Date("2026-07-24T00:00:07.000Z"),
    );
    expect(cleanup?.phase).toBe("cleanup-pending");
    expect(JSON.stringify(cleanup)).not.toMatch(/zipPath|filename|localPath/i);
  });

  it("clears only the exact ledger and exact revision", async () => {
    const ledger = requiredLedger();
    localValues[STORAGE_KEY] = ledger;

    await expect(
      clearSinglePeriodBundleLedger("single-period:other", ledger.revision),
    ).resolves.toBe(false);
    await expect(clearSinglePeriodBundleLedger(ledger.ledgerId, 99)).resolves.toBe(false);
    expect(localValues[STORAGE_KEY]).toBeDefined();
    await expect(clearSinglePeriodBundleLedger(ledger.ledgerId, ledger.revision)).resolves.toBe(
      true,
    );
    expect(localValues[STORAGE_KEY]).toBeUndefined();
  });

  it("clears only an exact legacy staging record and rejects extra legacy fields", async () => {
    const ledgerId = "single-period:12345678-legacy";
    localValues[STORAGE_KEY] = { ledgerId, schemaVersion: "1.0" };

    await expect(readSinglePeriodBundleLedgerStorageState()).resolves.toEqual({
      ledgerId,
      state: "legacy",
    });
    await expect(clearLegacySinglePeriodStagingRecord("single-period:other")).resolves.toBe(false);
    await expect(clearLegacySinglePeriodStagingRecord(ledgerId)).resolves.toBe(true);
    expect(localValues[STORAGE_KEY]).toBeUndefined();

    localValues[STORAGE_KEY] = {
      ledgerId,
      rawUrl: "synthetic-forbidden",
      schemaVersion: "1.0",
    };
    await expect(readSinglePeriodBundleLedgerStorageState()).resolves.toMatchObject({
      recoverableLedgerId: ledgerId,
      state: "malformed",
    });
    await expect(clearLegacySinglePeriodStagingRecord(ledgerId)).resolves.toBe(false);
    expect(localValues[STORAGE_KEY]).toBeDefined();
  });

  it("rejects malformed, extra-key, reordered-plan, and scope-conflict state without deleting it", async () => {
    const ledger = requiredLedger();
    localValues[STORAGE_KEY] = { ...ledger, rawUrl: "synthetic-forbidden" };
    await expect(readSinglePeriodBundleLedgerStorageState()).resolves.toEqual({
      recoverableLedgerId: ledger.ledgerId,
      state: "malformed",
    });
    await expect(reserveSinglePeriodBundleLedger(GSTR2B_SCOPE, CREATED_AT)).resolves.toEqual({
      recoverableLedgerId: ledger.ledgerId,
      state: "malformed",
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();

    localValues[STORAGE_KEY] = { ...ledger, artifactPlan: ["EXCEL", "PDF"] };
    await expect(readSinglePeriodBundleLedgerStorageState()).resolves.toMatchObject({
      state: "malformed",
    });

    localValues[STORAGE_KEY] = {
      ...ledger,
      artifacts: [
        ledger.artifacts[0],
        {
          ...ledger.artifacts[1],
          safeSignals: ["single-period-bundle-artifact-running"],
          startedAt: CREATED_AT.toISOString(),
          status: "running",
        },
      ],
    };
    await expect(readSinglePeriodBundleLedgerStorageState()).resolves.toMatchObject({
      state: "malformed",
    });

    localValues[STORAGE_KEY] = { ...ledger, revision: Number.MAX_SAFE_INTEGER };
    await expect(readSinglePeriodBundleLedgerStorageState()).resolves.toMatchObject({
      state: "malformed",
    });

    localValues[STORAGE_KEY] = {
      ...ledger,
      updatedAt: "2026-07-23T23:59:59.000Z",
    };
    await expect(readSinglePeriodBundleLedgerStorageState()).resolves.toMatchObject({
      state: "malformed",
    });

    expect(sameSinglePeriodBundleScope(ledger.scope, { ...ledger.scope, period: "May" })).toBe(
      false,
    );
    expect(localValues[STORAGE_KEY]).toBeDefined();
  });

  it("rejects stale revisions and staging claims without a target-bound diagnostic", async () => {
    const initial = requiredLedger();
    localValues[STORAGE_KEY] = initial;
    const running = await persistSinglePeriodBundleArtifactRunning(initial, "PDF", PDF_RUNNING_AT);

    await expect(
      persistSinglePeriodBundleArtifactRunning(initial, "EXCEL", EXCEL_RUNNING_AT),
    ).resolves.toBeNull();
    const missingDiagnosticStep = stagedStep(GSTR2B_SCOPE, "PDF");
    delete missingDiagnosticStep.downloadDiagnostic;
    expect(
      markSinglePeriodBundleArtifactStaged(running!, "PDF", missingDiagnosticStep, PDF_STAGED_AT),
    ).toBeNull();
  });
});

function requiredLedger() {
  return createSinglePeriodBundleLedger(
    GSTR2B_SCOPE,
    "single-period:12345678-durable",
    CREATED_AT,
  )!;
}

async function persistBothArtifacts() {
  const initial = requiredLedger();
  localValues[STORAGE_KEY] = initial;
  const pdfRunning = await persistSinglePeriodBundleArtifactRunning(initial, "PDF", PDF_RUNNING_AT);
  const pdfStaged = await persistSinglePeriodBundleArtifactStaged(
    pdfRunning!,
    "PDF",
    stagedStep(GSTR2B_SCOPE, "PDF"),
    PDF_STAGED_AT,
  );
  const excelRunning = await persistSinglePeriodBundleArtifactRunning(
    pdfStaged!,
    "EXCEL",
    EXCEL_RUNNING_AT,
  );
  return persistSinglePeriodBundleArtifactStaged(
    excelRunning!,
    "EXCEL",
    stagedStep(GSTR2B_SCOPE, "EXCEL"),
    EXCEL_STAGED_AT,
  );
}

function stagedStep(
  scope: FiledReturnsDownloadScope,
  artifactType: "PDF" | "EXCEL",
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    downloadDiagnostic: diagnostic(scope, artifactType, "downloaded"),
    safeMessage: "Pack staged the target-bound artifact.",
    safeSignals: [
      `filed-return-artifact-downloaded:${artifactType}`,
      "single-period-opfs-staged",
      `single-period-opfs-staged:${artifactType}`,
    ],
    scopeId: "gst-filed-returns-private-v0",
    state: "downloaded",
  };
}

function unavailableExcelStep(scope: FiledReturnsDownloadScope): PortalFlowStepResult {
  return {
    connectorId: "gst",
    downloadDiagnostic: diagnostic(scope, "EXCEL", "blocked"),
    safeMessage: "The optional artifact is unavailable.",
    safeSignals: ["filed-gstr1-excel-no-details-available"],
    scopeId: "gst-filed-returns-private-v0",
    state: "blocked",
  };
}

function diagnostic(
  scope: FiledReturnsDownloadScope,
  artifactType: "PDF" | "EXCEL",
  status: PortalFlowStepResult["state"],
): FiledReturnsDownloadDiagnostic {
  return {
    actionId: `action-12345678-${artifactType.toLowerCase()}`,
    artifactType,
    byteCountClass: "non-empty",
    downloadPathClass: "captured-portal-request-data",
    endpointClass:
      scope.returnType === "GSTR-1"
        ? artifactType === "PDF"
          ? "gstr1-pdf-portal-blob-captured-download"
          : "gstr1-excel-portal-blob-captured-download"
        : "gstr2b-portal-blob-captured-download",
    eventType: "filed-return-download-path",
    financialYear: scope.financialYear,
    mimeClass: artifactType === "PDF" ? "pdf" : "spreadsheet",
    period: scope.period,
    returnType: scope.returnType,
    schemaVersion: "1.0",
    status,
  };
}

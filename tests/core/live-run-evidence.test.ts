import { describe, expect, it } from "vitest";
import {
  computeLiveRunEvidenceDigest,
  validateLiveRunEvidence,
  validateLiveRunEvidenceJson,
  type LiveRunEvidence,
} from "../../scripts/lib/live-run-evidence";

describe("live run evidence", () => {
  it("accepts a redacted full-year evidence summary", () => {
    const result = validateLiveRunEvidence(createValidEvidence());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.counts.downloaded).toBe(1);
      expect(result.evidence.redaction.containsGstin).toBe(false);
    }
  });

  it("rejects taxpayer, portal, path, file, and credential markers anywhere in the evidence", () => {
    const cases: Array<[string, Partial<LiveRunEvidence>]> = [
      ["gstin", withEvidenceText("Observed 27ABCDE1234F1Z5 in the portal.")],
      ["pan", withEvidenceText("Observed ABCDE1234F in the portal.")],
      ["arn", withEvidenceText("Portal displayed ARN AA2901234567890.")],
      ["portal-url", withEvidenceText("https://services.gst.gov.in/services/auth/efiledreturns")],
      ["local-path", withEvidenceText("/Users/example/Downloads/gstr3b.pdf")],
      ["local-path", withEvidenceText("/home/alice/Downloads/download.pdf")],
      ["local-path", withEvidenceText("/tmp/pack/evidence.json")],
      ["local-path", withEvidenceText("/workspace/pack/live-evidence.json")],
      ["local-path", withEvidenceText("/root/pack/live-evidence.json")],
      ["local-path", withEvidenceText("/opt/pack/live-evidence.json")],
      ["local-path", withEvidenceText("/var/tmp/pack/live-evidence.json")],
      ["local-path", withEvidenceText("file:///workspace/pack/live-evidence.json")],
      ["filename", withEvidenceText("Saved download.pdf")],
      ["filename", withEvidenceText("Saved returns_april.zip")],
      ["secret", withEvidenceText("authorization: Bearer secret-value")],
      ["secret", withEvidenceText('{"cookie":"SID=secret-value"}')],
      ["secret", withEvidenceText('{"x-csrf-token":"abc"}')],
      ["secret", withEvidenceText("otp: 123456")],
      ["secret", withEvidenceText("captcha: AB12C")],
      ["secret", withEvidenceText("password: secret-value")],
      ["pdf", withEvidenceText("%PDF-1.7")],
      ["pdf", withEvidenceText("data:application/pdf;base64,JVBERi0x")],
    ];

    for (const [expected, patch] of cases) {
      const result = validateLiveRunEvidence({ ...createValidEvidence(), ...patch });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join("\n")).toContain(expected);
    }
  });

  it("rejects free-form notes in shareable evidence", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      notes: "Manual tester saw a client name here.",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("notes is not allowed in shareable evidence");
  });

  it("rejects fields outside the evidence schema", () => {
    const topLevel = validateLiveRunEvidence({
      ...createValidEvidence(),
      reviewerComment: "looks clean",
    });
    const nested = validateLiveRunEvidence({
      ...createValidEvidence(),
      counts: {
        ...createValidEvidence().counts,
        ignoredTargets: 1,
      },
    });

    expect(topLevel.ok).toBe(false);
    if (!topLevel.ok) expect(topLevel.errors).toContain("evidence.reviewerComment is not allowed");
    expect(nested.ok).toBe(false);
    if (!nested.ok) expect(nested.errors).toContain("counts.ignoredTargets is not allowed");
  });

  it("requires return scope fields that identify the tested artifact", () => {
    const evidenceWithoutReturnType = { ...createValidEvidence() } as Record<string, unknown>;
    delete evidenceWithoutReturnType.returnType;
    const missingReturnType = validateLiveRunEvidence(evidenceWithoutReturnType);
    const invalidGstr3bArtifact = validateLiveRunEvidence({
      ...createValidEvidence(),
      artifactType: "PDF_AND_EXCEL",
    });
    const invalidFullYearPeriod = validateLiveRunEvidence({
      ...createValidEvidence(),
      period: "May",
    });
    const validGstr1Combined = validateLiveRunEvidence({
      ...createValidEvidence(),
      returnType: "GSTR-1",
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      downloadEvidence: [
        {
          ...createValidEvidence().downloadEvidence[0],
          actionId: "action-gstr1-pdf",
          returnType: "GSTR-1",
          financialYear: "2025-26",
          endpointClass: "gstr1-pdf-portal-blob-captured-download",
          downloadPathClass: "captured-portal-request-data",
        },
        {
          ...createValidEvidence().downloadEvidence[0],
          actionId: "action-gstr1-excel",
          artifactType: "EXCEL",
          returnType: "GSTR-1",
          financialYear: "2025-26",
          endpointClass: "gstr1-excel-portal-blob-captured-download",
          downloadPathClass: "captured-portal-request-data",
        },
      ],
    });

    expect(missingReturnType.ok).toBe(false);
    if (!missingReturnType.ok)
      expect(missingReturnType.errors).toContain(
        "returnType must be one of GSTR-3B, GSTR-1, GSTR-2B",
      );
    expect(invalidGstr3bArtifact.ok).toBe(false);
    if (!invalidGstr3bArtifact.ok)
      expect(invalidGstr3bArtifact.errors).toContain("GSTR-3B evidence must use artifactType PDF");
    expect(invalidFullYearPeriod.ok).toBe(false);
    if (!invalidFullYearPeriod.ok)
      expect(invalidFullYearPeriod.errors).toContain(
        "full-year evidence must use period FULL_FISCAL_YEAR",
      );
    expect(validGstr1Combined).toMatchObject({ ok: true });
  });

  it("requires both concrete artifacts for every downloaded combined period", () => {
    const pdfOnly = createValidEvidence().downloadEvidence[0];
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      returnType: "GSTR-1",
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      downloadEvidence: [
        {
          ...pdfOnly,
          actionId: "action-gstr1-pdf",
          returnType: "GSTR-1",
          financialYear: "2025-26",
          endpointClass: "gstr1-pdf-portal-blob-captured-download",
          downloadPathClass: "captured-portal-request-data",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "pass combined evidence must include PDF and EXCEL for each downloaded period",
      );
    }
  });

  it("accepts redacted GSTR-2B PDF and Excel evidence metadata", () => {
    expect(
      validateLiveRunEvidence({
        ...createValidEvidence(),
        returnType: "GSTR-2B",
        artifactType: "PDF_AND_EXCEL",
        downloadEvidence: [
          {
            ...createValidEvidence().downloadEvidence[0],
            actionId: "action-gstr2b-pdf",
            returnType: "GSTR-2B",
            endpointClass: "gstr2b-portal-blob-captured-download",
            downloadPathClass: "captured-portal-request-data",
          },
          {
            ...createValidEvidence().downloadEvidence[0],
            actionId: "action-gstr2b-excel",
            artifactType: "EXCEL",
            returnType: "GSTR-2B",
            endpointClass: "gstr2b-portal-blob-captured-download",
            downloadPathClass: "captured-portal-request-data",
          },
        ],
      }),
    ).toMatchObject({ ok: true });
  });

  it("accepts captured GSTR-3B endpoint evidence metadata", () => {
    expect(
      validateLiveRunEvidence({
        ...createValidEvidence(),
        downloadEvidence: [
          {
            ...createValidEvidence().downloadEvidence[0],
            endpointClass: "gstr3b-portal-blob-captured-download",
            downloadPathClass: "captured-portal-request-data",
          },
        ],
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects endpoint and path combinations that runtime diagnostics cannot emit", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      downloadEvidence: [
        {
          ...createValidEvidence().downloadEvidence[0],
          endpointClass: "gstr3b-getgenpdf",
          downloadPathClass: "captured-portal-request-data",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "downloadEvidence[0].endpointClass is inconsistent with downloadPathClass",
      );
    }
  });

  it("requires one downloaded evidence entry per downloaded target", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      counts: {
        ...createValidEvidence().counts,
        downloaded: 10,
        notFiled: 2,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "pass evidence must include one unique period per downloaded target",
      );
    }
  });

  it("allows an all-not-filed pass without fabricated download evidence", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      counts: {
        ...createValidEvidence().counts,
        downloaded: 0,
        notFiled: 12,
      },
      downloadEvidence: [],
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("rejects duplicate downloaded target and action identities", () => {
    const first = createValidEvidence().downloadEvidence[0];
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      counts: { ...createValidEvidence().counts, downloaded: 2, notFiled: 10 },
      downloadEvidence: [first, { ...first }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          "pass evidence must include one unique period per downloaded target",
          "pass evidence cannot duplicate a downloaded period and artifact",
          "pass evidence cannot reuse a downloaded actionId",
        ]),
      );
    }
  });

  it("rejects unknown endpoints and unresolved statuses from pass evidence", () => {
    const first = createValidEvidence().downloadEvidence[0];
    const unknownEndpoint = validateLiveRunEvidence({
      ...createValidEvidence(),
      downloadEvidence: [{ ...first, endpointClass: "unknown" }],
    });
    const failedRow = validateLiveRunEvidence({
      ...createValidEvidence(),
      downloadEvidence: [
        first,
        { ...first, actionId: "action-failed", period: "May", status: "failed" },
      ],
    });

    expect(unknownEndpoint.ok).toBe(false);
    if (!unknownEndpoint.ok) {
      expect(unknownEndpoint.errors).toContain(
        "downloadEvidence[0].endpointClass cannot be unknown for passed downloads",
      );
    }
    expect(failedRow.ok).toBe(false);
    if (!failedRow.ok) {
      expect(failedRow.errors).toContain(
        "pass evidence cannot include unresolved downloadEvidence statuses",
      );
    }
  });

  it("scans raw evidence JSON before parsing", () => {
    const source = JSON.stringify({
      ...createValidEvidence(),
      evidenceId: "\\u002fhome\\u002falice\\u002fDownloads\\u002freturn.pdf",
    });

    const result = validateLiveRunEvidenceJson(source);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("sensitive marker filename found in evidence");
  });

  it("requires all redaction assertions to be false", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      redaction: {
        ...createValidEvidence().redaction,
        containsFilename: true,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("redaction.containsFilename must be false");
  });

  it("requires full-year evidence to include restart and resume checks", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      checks: {
        ...createValidEvidence().checks,
        browserRestartResumeChecked: false,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toContain("checks.browserRestartResumeChecked must be true");
  });

  it("requires pass evidence to include sanitized download path evidence", () => {
    const missing = { ...createValidEvidence() } as Record<string, unknown>;
    delete missing.downloadEvidence;
    const invalidPath = validateLiveRunEvidence({
      ...createValidEvidence(),
      downloadEvidence: [
        {
          ...createValidEvidence().downloadEvidence[0],
          downloadPathClass: "raw-url",
        },
      ],
    });

    const missingResult = validateLiveRunEvidence(missing);

    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok)
      expect(missingResult.errors).toContain("downloadEvidence must be an array");
    expect(invalidPath.ok).toBe(false);
    if (!invalidPath.ok) {
      expect(invalidPath.errors).toContain(
        "downloadEvidence[0].downloadPathClass must be one of extension-direct-https, extension-direct-blob, extension-direct-data, extension-direct-unknown, portal-click-https, portal-click-blob, portal-click-data, portal-click-unknown, portal-click-after-direct-fallback-https, portal-click-after-direct-fallback-blob, portal-click-after-direct-fallback-data, portal-click-after-direct-fallback-unknown, captured-portal-request-https, captured-portal-request-blob, captured-portal-request-data, captured-portal-request-unknown",
      );
    }
  });

  it("requires pass evidence to have reconciled targets and no blocking counts", () => {
    const noTargets = validateLiveRunEvidence({
      ...createValidEvidence(),
      counts: {
        eligibleTargets: 0,
        downloaded: 0,
        notFiled: 0,
        manuallyObserved: 0,
        blocked: 0,
        failed: 0,
        duplicates: 0,
      },
    });
    const blockedPass = validateLiveRunEvidence({
      ...createValidEvidence(),
      counts: {
        ...createValidEvidence().counts,
        blocked: 1,
      },
    });

    expect(noTargets.ok).toBe(false);
    if (!noTargets.ok)
      expect(noTargets.errors).toContain("counts must include at least one reconciled target");
    expect(blockedPass.ok).toBe(false);
    if (!blockedPass.ok)
      expect(blockedPass.errors).toContain("pass evidence cannot include blocked targets");
  });

  it("requires evidence to reconcile every eligible target", () => {
    const fullYear = validateLiveRunEvidence({
      ...createValidEvidence(),
      counts: {
        ...createValidEvidence().counts,
        eligibleTargets: 12,
        downloaded: 10,
        notFiled: 1,
      },
    });
    const singlePeriod = validateLiveRunEvidence({
      ...createValidEvidence(),
      scenario: "single-period",
      checks: {
        ...createValidEvidence().checks,
        serviceWorkerRestartResumeChecked: false,
        browserRestartResumeChecked: false,
      },
      counts: {
        ...createValidEvidence().counts,
        eligibleTargets: 3,
        downloaded: 1,
        notFiled: 0,
      },
    });
    const blocked = validateLiveRunEvidence({
      ...createValidEvidence(),
      outcome: "blocked",
      counts: {
        eligibleTargets: 12,
        downloaded: 0,
        notFiled: 0,
        manuallyObserved: 0,
        blocked: 1,
        failed: 0,
        duplicates: 0,
      },
      checks: {
        humanVerifiedAccount: false,
        humanVerifiedPeriods: false,
        allFilesNonEmpty: false,
        serviceWorkerRestartResumeChecked: false,
        browserRestartResumeChecked: false,
        clearLocalDataChecked: false,
        browserSummaryCaptured: false,
        unexpectedNetworkDestinations: 0,
      },
    });

    expect(fullYear.ok).toBe(false);
    if (!fullYear.ok) {
      expect(fullYear.errors).toContain("pass evidence must reconcile every eligible target");
      expect(fullYear.errors).toContain("counts must reconcile eligible targets");
    }
    expect(singlePeriod.ok).toBe(false);
    if (!singlePeriod.ok) {
      expect(singlePeriod.errors).toContain("pass evidence must reconcile every eligible target");
      expect(singlePeriod.errors).toContain("counts must reconcile eligible targets");
    }
    expect(blocked.ok).toBe(true);
  });

  it("accepts partial observed counts for blocked full-year live evidence without inflating target totals", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      outcome: "blocked",
      counts: {
        eligibleTargets: 12,
        downloaded: 2,
        notFiled: 0,
        manuallyObserved: 0,
        blocked: 1,
        failed: 0,
        duplicates: 0,
      },
      checks: {
        humanVerifiedAccount: false,
        humanVerifiedPeriods: false,
        allFilesNonEmpty: false,
        serviceWorkerRestartResumeChecked: false,
        browserRestartResumeChecked: false,
        clearLocalDataChecked: false,
        browserSummaryCaptured: false,
        unexpectedNetworkDestinations: 0,
      },
      limitations: ["browser-state-not-captured"],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects blocked or failed live evidence counts that observe more targets than were eligible", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      outcome: "blocked",
      counts: {
        eligibleTargets: 2,
        downloaded: 2,
        notFiled: 0,
        manuallyObserved: 0,
        blocked: 1,
        failed: 0,
        duplicates: 0,
      },
      checks: {
        humanVerifiedAccount: false,
        humanVerifiedPeriods: false,
        allFilesNonEmpty: false,
        serviceWorkerRestartResumeChecked: false,
        browserRestartResumeChecked: false,
        clearLocalDataChecked: false,
        browserSummaryCaptured: false,
        unexpectedNetworkDestinations: 0,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("counts cannot exceed eligible targets");
  });

  it("does not require success-only checks for blocked evidence", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      outcome: "blocked",
      counts: {
        eligibleTargets: 1,
        downloaded: 0,
        notFiled: 0,
        manuallyObserved: 0,
        blocked: 1,
        failed: 0,
        duplicates: 0,
      },
      checks: {
        humanVerifiedAccount: false,
        humanVerifiedPeriods: false,
        allFilesNonEmpty: false,
        serviceWorkerRestartResumeChecked: false,
        browserRestartResumeChecked: false,
        clearLocalDataChecked: false,
        browserSummaryCaptured: false,
        unexpectedNetworkDestinations: 0,
      },
    });

    expect(result.ok).toBe(true);
  });

  it("allows only controlled limitation codes for blocked evidence", () => {
    const blockedEvidence = {
      ...createValidEvidence(),
      outcome: "blocked",
      counts: {
        eligibleTargets: 1,
        downloaded: 0,
        notFiled: 0,
        manuallyObserved: 0,
        blocked: 1,
        failed: 0,
        duplicates: 0,
      },
      checks: {
        humanVerifiedAccount: false,
        humanVerifiedPeriods: false,
        allFilesNonEmpty: false,
        serviceWorkerRestartResumeChecked: false,
        browserRestartResumeChecked: false,
        clearLocalDataChecked: false,
        browserSummaryCaptured: false,
        unexpectedNetworkDestinations: 0,
      },
    };
    const accepted = validateLiveRunEvidence({
      ...blockedEvidence,
      limitations: ["browser-state-not-captured", "service-worker-restart-not-verified"],
    });
    const rejected = validateLiveRunEvidence({
      ...blockedEvidence,
      limitations: ["manual tester saw client name"],
    });
    const duplicate = validateLiveRunEvidence({
      ...blockedEvidence,
      limitations: ["browser-state-not-captured", "browser-state-not-captured"],
    });

    expect(accepted.ok).toBe(true);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok)
      expect(rejected.errors).toContain(
        "limitations[0] must be one of clean-profile-not-verified, human-account-match-not-verified, human-period-match-not-verified, file-non-empty-check-not-verified, service-worker-restart-not-verified, browser-restart-not-verified, clear-local-data-not-verified, browser-state-not-captured",
      );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok)
      expect(duplicate.errors).toContain("limitations[1] duplicates browser-state-not-captured");
  });

  it("rejects limitation codes on pass evidence", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      limitations: ["browser-state-not-captured"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("pass evidence cannot include limitations");
  });

  it("requires passing evidence to use a clean profile and zero unexpected network destinations", () => {
    const dirtyProfile = validateLiveRunEvidence({
      ...createValidEvidence(),
      profile: "default",
    });
    const unexpectedNetwork = validateLiveRunEvidence({
      ...createValidEvidence(),
      checks: {
        ...createValidEvidence().checks,
        unexpectedNetworkDestinations: 1,
      },
    });

    expect(dirtyProfile.ok).toBe(false);
    if (!dirtyProfile.ok)
      expect(dirtyProfile.errors).toContain("pass evidence must use clean-test-profile");
    expect(unexpectedNetwork.ok).toBe(false);
    if (!unexpectedNetwork.ok) {
      expect(unexpectedNetwork.errors).toContain(
        "pass evidence cannot include unexpected network destinations",
      );
    }
  });

  it("requires neutral subject aliases and ordered timestamps", () => {
    const namedAlias = validateLiveRunEvidence({
      ...createValidEvidence(),
      subjectAlias: "Acme Traders",
    });
    const reversedDates = validateLiveRunEvidence({
      ...createValidEvidence(),
      startedAt: "2026-06-26T08:30:00.000Z",
      completedAt: "2026-06-26T08:00:00.000Z",
    });
    const encodedAlias = validateLiveRunEvidence({
      ...createValidEvidence(),
      subjectAlias: "SUBJECT-ACME-TRADERS",
    });
    const invalidCalendarDate = validateLiveRunEvidence({
      ...createValidEvidence(),
      startedAt: "2026-02-30T08:00:00.000Z",
    });

    expect(namedAlias.ok).toBe(false);
    if (!namedAlias.ok)
      expect(namedAlias.errors).toContain("subjectAlias must be a neutral SUBJECT-* alias");
    expect(reversedDates.ok).toBe(false);
    if (!reversedDates.ok)
      expect(reversedDates.errors).toContain("completedAt must be after startedAt");
    expect(encodedAlias.ok).toBe(false);
    if (!encodedAlias.ok)
      expect(encodedAlias.errors).toContain("subjectAlias must be a neutral SUBJECT-* alias");
    expect(invalidCalendarDate.ok).toBe(false);
    if (!invalidCalendarDate.ok)
      expect(invalidCalendarDate.errors).toContain("startedAt is invalid");
  });

  it("rejects live portal screenshots or videos as public evidence artifacts", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      mediaArtifacts: [
        {
          kind: "screenshot",
          classification: "public-redacted-live-portal",
          redactionMethod: "manual-blur",
          sha256: "a".repeat(64),
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "mediaArtifacts[0].classification cannot publish live portal captures",
      );
    }
  });

  it("computes a stable digest independent of object key insertion order", () => {
    const left = createValidEvidence();
    const right = {
      ...left,
      counts: {
        eligibleTargets: 12,
        duplicates: 0,
        failed: 0,
        blocked: 0,
        manuallyObserved: 0,
        notFiled: 11,
        downloaded: 1,
      },
    };

    expect(computeLiveRunEvidenceDigest(left)).toBe(computeLiveRunEvidenceDigest(right));
  });
});

function withEvidenceText(text: string): Partial<LiveRunEvidence> {
  return { evidenceId: text };
}

function createValidEvidence(): LiveRunEvidence {
  return {
    schemaVersion: 1,
    evidenceId: "pack-live-run-2026-06-26-subject-a-full-year",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    gitTag: "v0.1.1",
    zipSha256: "b".repeat(64),
    extensionVersion: "0.1.1",
    browser: {
      name: "Brave",
      version: "1.80.122",
    },
    profile: "clean-test-profile",
    subjectAlias: "SUBJECT-A",
    returnType: "GSTR-3B",
    artifactType: "PDF",
    financialYear: "2026-27",
    period: "FULL_FISCAL_YEAR",
    scenario: "full-year",
    startedAt: "2026-06-26T08:00:00.000Z",
    completedAt: "2026-06-26T08:30:00.000Z",
    outcome: "pass",
    counts: {
      eligibleTargets: 12,
      downloaded: 1,
      notFiled: 11,
      manuallyObserved: 0,
      blocked: 0,
      failed: 0,
      duplicates: 0,
    },
    checks: {
      humanVerifiedAccount: true,
      humanVerifiedPeriods: true,
      allFilesNonEmpty: true,
      serviceWorkerRestartResumeChecked: true,
      browserRestartResumeChecked: true,
      clearLocalDataChecked: true,
      browserSummaryCaptured: true,
      unexpectedNetworkDestinations: 0,
    },
    downloadEvidence: [
      {
        actionId: "action-april",
        returnType: "GSTR-3B",
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "April",
        endpointClass: "gstr3b-getgenpdf",
        downloadPathClass: "extension-direct-https",
        status: "downloaded",
        askWhereToSave: "off",
        filenameCollision: "absent",
        multipleDownloadPrompt: "not-shown",
        exactZipBuild: "b".repeat(64),
      },
    ],
    redaction: {
      containsGstin: false,
      containsPan: false,
      containsTaxpayerName: false,
      containsFilename: false,
      containsPortalUrl: false,
      containsLocalPath: false,
      containsPdf: false,
      containsCookieOrToken: false,
      containsPortalHtml: false,
      containsScreenshotOrVideo: false,
    },
    mediaArtifacts: [
      {
        kind: "screen-recording",
        classification: "private-debug-only",
        redactionMethod: "not-published",
        sha256: "c".repeat(64),
      },
    ],
  };
}

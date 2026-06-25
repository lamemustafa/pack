import { describe, expect, it } from "vitest";
import {
  computeLiveRunEvidenceDigest,
  validateLiveRunEvidence,
  type LiveRunEvidence,
} from "../../scripts/lib/live-run-evidence";

describe("live run evidence", () => {
  it("accepts a redacted full-year evidence summary", () => {
    const result = validateLiveRunEvidence(createValidEvidence());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.counts.downloaded).toBe(10);
      expect(result.evidence.redaction.containsGstin).toBe(false);
    }
  });

  it("rejects taxpayer, portal, path, file, and credential markers anywhere in the evidence", () => {
    const cases: Array<[string, Partial<LiveRunEvidence>]> = [
      ["gstin", { notes: "Observed 27ABCDE1234F1Z5 in the portal." }],
      ["pan", { notes: "Observed ABCDE1234F in the portal." }],
      ["arn", { notes: "Portal displayed ARN AA2901234567890." }],
      ["portal-url", { notes: "https://services.gst.gov.in/services/auth/efiledreturns" }],
      ["local-path", { notes: "/Users/example/Downloads/gstr3b.pdf" }],
      ["local-path", { notes: "/home/alice/Downloads/download.pdf" }],
      ["local-path", { notes: "/tmp/pack/evidence.json" }],
      ["filename", { notes: "Saved download.pdf" }],
      ["filename", { notes: "Saved returns_april.zip" }],
      ["secret", { notes: "authorization: Bearer secret-value" }],
      ["secret", { notes: '{"cookie":"SID=secret-value"}' }],
      ["secret", { notes: '{"x-csrf-token":"abc"}' }],
    ];

    for (const [expected, patch] of cases) {
      const result = validateLiveRunEvidence({ ...createValidEvidence(), ...patch });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join("\n")).toContain(expected);
    }
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

  it("requires full-year pass evidence to reconcile every eligible target", () => {
    const result = validateLiveRunEvidence({
      ...createValidEvidence(),
      counts: {
        ...createValidEvidence().counts,
        eligibleTargets: 12,
        downloaded: 10,
        notFiled: 1,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "full-year pass evidence must reconcile every eligible target",
      );
    }
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

    expect(namedAlias.ok).toBe(false);
    if (!namedAlias.ok)
      expect(namedAlias.errors).toContain("subjectAlias must be a neutral SUBJECT-* alias");
    expect(reversedDates.ok).toBe(false);
    if (!reversedDates.ok)
      expect(reversedDates.errors).toContain("completedAt must be after startedAt");
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
        notFiled: 2,
        downloaded: 10,
      },
    };

    expect(computeLiveRunEvidenceDigest(left)).toBe(computeLiveRunEvidenceDigest(right));
  });
});

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
    scenario: "full-year",
    startedAt: "2026-06-26T08:00:00.000Z",
    completedAt: "2026-06-26T08:30:00.000Z",
    outcome: "pass",
    counts: {
      eligibleTargets: 12,
      downloaded: 10,
      notFiled: 2,
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
      unexpectedNetworkDestinations: 0,
    },
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

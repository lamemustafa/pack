import type {
  DownloadPlan,
  DownloadResult,
  DownloadScope,
  DownloadTarget,
} from "../../core/contracts";
import { buildRelativePath, makeTargetId, normalisePackFilename } from "../../core/naming";
import {
  DEFAULT_GST_DISCLOSURES,
  GST_CONNECTOR_DESCRIPTOR,
  PRIVATE_FILED_RETURNS_SPIKE_DISCLOSURE,
} from "./constants";

export const DEFAULT_GST_RETURN_SCOPE: DownloadScope = {
  financialYears: ["FY-2023-24"],
  periods: ["APR", "MAY", "JUN"],
  documentTypes: ["GSTR-1", "GSTR-3B", "GSTR-2B"],
  formats: ["pdf", "json"],
  sourcePreference: "portal-original-only",
};

export const FILED_RETURNS_PRIVATE_SPIKE_SCOPE: DownloadScope = {
  financialYears: ["FY-2023-24"],
  periods: ["APR", "MAY", "JUN"],
  documentTypes: ["GSTR-3B"],
  formats: ["pdf"],
  sourcePreference: "portal-original-only",
};

export function createGstReturnPlan(scope: DownloadScope, now = new Date()): DownloadPlan {
  const targets: DownloadTarget[] = [];

  for (const financialYear of scope.financialYears) {
    for (const period of scope.periods) {
      for (const documentType of scope.documentTypes) {
        const format = preferredFormat(documentType, scope.formats);
        targets.push({
          targetId: makeTargetId({ documentType, financialYear, period, format }),
          documentType,
          period,
          financialYear,
          requestedFormat: format,
          expectedSourceKind:
            documentType === "GSTR-2B" ? "government-structured-data" : "portal-original",
          applicability: "possible",
        });
      }
    }
  }

  return {
    schemaVersion: "1.0",
    planId: `pack-${now.getTime().toString(36)}`,
    connector: GST_CONNECTOR_DESCRIPTOR,
    createdAt: now.toISOString(),
    executionMode: "local-browser",
    scope,
    targets,
    disclosuresAccepted: DEFAULT_GST_DISCLOSURES,
  };
}

export function createFiledReturnsPrivateSpikePlan(now = new Date()): DownloadPlan {
  const plan = createGstReturnPlan(FILED_RETURNS_PRIVATE_SPIKE_SCOPE, now);
  return {
    ...plan,
    disclosuresAccepted: [...plan.disclosuresAccepted, PRIVATE_FILED_RETURNS_SPIKE_DISCLOSURE],
  };
}

export function createSyntheticGstResults(plan: DownloadPlan, now = new Date()): DownloadResult[] {
  return plan.targets.map((target, index) => {
    if (index % 7 === 5) {
      return {
        schemaVersion: "1.0",
        targetId: target.targetId,
        status: "not-filed",
        completedAt: now.toISOString(),
        portalMetadata: {
          filingStatus: "Not filed",
          ...(target.period ? { taxPeriod: target.period } : {}),
        },
      };
    }

    if (index % 11 === 8) {
      return {
        schemaVersion: "1.0",
        targetId: target.targetId,
        status: "generation-pending",
        completedAt: now.toISOString(),
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "The portal indicates generation is pending for this synthetic target.",
          canResume: true,
        },
      };
    }

    const extension = target.documentType === "GSTR-2B" ? "json" : "pdf";
    const filename = normalisePackFilename(
      `${target.financialYear}-${target.period}-${target.documentType}-synthetic`,
      extension,
    );

    return {
      schemaVersion: "1.0",
      targetId: target.targetId,
      status: "downloaded",
      startedAt: plan.createdAt,
      completedAt: now.toISOString(),
      artifact: {
        sourceKind: target.expectedSourceKind,
        originalFilename: filename,
        normalisedFilename: filename,
        relativePath: buildRelativePath({
          subjectLabel: "Synthetic GSTIN",
          financialYear: target.financialYear ?? "FY-UNKNOWN",
          documentType: target.documentType,
          filename,
        }),
        mimeType: extension === "pdf" ? "application/pdf" : "application/json",
        sizeBytes: extension === "pdf" ? 24576 : 2048,
        integrityState: "not-computed",
      },
      portalMetadata: {
        filingStatus: "Filed",
        ...(target.period ? { taxPeriod: target.period } : {}),
      },
    };
  });
}

function preferredFormat(documentType: string, formats: readonly string[]): string {
  if (documentType === "GSTR-2B" && formats.includes("json")) return "json";
  return formats[0] ?? "pdf";
}

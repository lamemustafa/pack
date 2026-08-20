import { canonicalJsonPointerSegments } from "../../core/json-flat-table";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export const FILED_RETURNS_GSTR3B_WORKBOOK_IDENTITY_LABELS = ["GSTIN", "Legal name"] as const;
export type FiledReturnsGstr3bWorkbookIdentityLabel =
  (typeof FILED_RETURNS_GSTR3B_WORKBOOK_IDENTITY_LABELS)[number];

export interface FiledReturnsSummaryIdentity {
  contextType: "taxpayer_identity" | "return_identity";
  label: string;
}

export function filedReturnsRequiredWorkbookIdentityLabels(
  returnType: FiledReturnsReturnType,
): readonly FiledReturnsGstr3bWorkbookIdentityLabel[] {
  return returnType === "GSTR-3B" ? FILED_RETURNS_GSTR3B_WORKBOOK_IDENTITY_LABELS : [];
}

export function filedReturnsSummaryIdentityLabel(path: string): string | null {
  return filedReturnsSummaryIdentity(path)?.label ?? null;
}

export function filedReturnsSummaryIdentity(path: string): FiledReturnsSummaryIdentity | null {
  const segments = canonicalJsonPointerSegments(path);
  const terminalIdentity = identityForCanonicalSegment(segments.at(-1) ?? "");
  if (terminalIdentity) return terminalIdentity;
  if (segments.at(-1) === "value") {
    return identityForCanonicalSegment(segments.at(-2) ?? "");
  }
  return null;
}

export function isFiledReturnsSummaryIdentityPath(path: string): boolean {
  return canonicalJsonPointerSegments(path).some(
    (segment) => identityForCanonicalSegment(segment) !== null,
  );
}

function identityForCanonicalSegment(segment: string): FiledReturnsSummaryIdentity | null {
  if (segment === "gstin") return taxpayerIdentity("GSTIN");
  if (segment === "pan" || segment === "panno" || segment === "taxpayerpan") {
    return taxpayerIdentity("PAN");
  }
  if (segment === "lglnm" || segment === "lgnm" || segment === "legalname") {
    return taxpayerIdentity("Legal name");
  }
  if (segment === "trdnm" || segment === "tradename") {
    return taxpayerIdentity("Trade name");
  }
  if (segment === "arn") return returnIdentity("ARN");
  if (segment === "arndt" || segment === "arndate") {
    return returnIdentity("ARN date");
  }
  if (segment === "taxpayername" || segment === "taxpyrname" || segment === "nameoftaxpayer") {
    return taxpayerIdentity("Taxpayer name");
  }
  if (
    segment === "signatory" ||
    segment === "authsig" ||
    segment === "signatoryname" ||
    segment === "authorizedsignatory" ||
    segment === "authorisedsignatory"
  ) {
    return taxpayerIdentity("Signatory");
  }
  if (segment === "designation" || segment === "desig") {
    return taxpayerIdentity("Designation");
  }
  return null;
}

function taxpayerIdentity(label: string): FiledReturnsSummaryIdentity {
  return { contextType: "taxpayer_identity", label };
}

function returnIdentity(label: string): FiledReturnsSummaryIdentity {
  return { contextType: "return_identity", label };
}

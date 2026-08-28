import {
  filedReturnsSafeSlug,
  filedReturnsScopeId,
  type FiledReturnsReturnType,
} from "./filed-returns-return-types";
import { filedReturnsCapability } from "./filed-returns-capabilities";

export interface FiledReturnDescriptor {
  label: string;
  signalSlug: string;
  reselectionDestination: "filed-returns" | "return-dashboard";
  detailRoutePattern: RegExp;
  detailHeadingPattern: RegExp;
  explicitDownloadPattern: RegExp;
  excelDownloadPattern?: RegExp;
  secondaryDownloadPattern?: RegExp;
  systemGeneratedPattern?: RegExp;
}

type FiledReturnMechanics = Omit<FiledReturnDescriptor, "label" | "signalSlug">;

const FILED_RETURN_MECHANICS: Record<FiledReturnsReturnType, FiledReturnMechanics> = {
  "GSTR-3B": {
    reselectionDestination: "filed-returns",
    detailRoutePattern: /\/returns\/auth\/gstr3b$/i,
    detailHeadingPattern: /\bgstr[\s-]?3b\s*-\s*monthly\s+return\b/i,
    explicitDownloadPattern: /\bdownload\s+filed\s+gstr[\s-]?3b\b/i,
    systemGeneratedPattern: /\bsystem\s+generated\b.*\bgstr[\s-]?3b\b/i,
  },
  "GSTR-1": {
    reselectionDestination: "return-dashboard",
    detailRoutePattern: /\/returns\/auth\/gstr1(?:\/|$)/i,
    detailHeadingPattern: /\bgstr[\s-]?1\b/i,
    explicitDownloadPattern: /\bdownload\s+filed\s+gstr[\s-]?1\b/i,
    excelDownloadPattern:
      /\bdownload\b.*\b(?:details?\b.*\b(?:e-?invoices?|excel)|excel\b.*\b(?:details?|e-?invoices?))\b/i,
    secondaryDownloadPattern: /\bdownload\s*\(?\s*pdf\s*\)?\b/i,
  },
  "GSTR-2B": {
    reselectionDestination: "return-dashboard",
    detailRoutePattern: /\/gstr2b\/auth\/gstr2b\/summary\/?$/i,
    detailHeadingPattern: /\bgstr[^a-z0-9]?2b\b/i,
    explicitDownloadPattern: /\bdownload\s+gstr[^a-z0-9]?2b\s+summary\s*\(?\s*pdf\s*\)?\b/i,
    excelDownloadPattern:
      /(?:\bdownload\s+gstr[^a-z0-9]?2b\s+details?\s*\(?\s*excel\s*\)?\b|\bdetails?\s*\(?\s*excel\s*\)?\b)/i,
    secondaryDownloadPattern: /\bsummary\s*\(?\s*pdf\s*\)?\b/i,
  },
};

export function filedReturnDescriptor(returnType: FiledReturnsReturnType): FiledReturnDescriptor {
  return {
    ...FILED_RETURN_MECHANICS[returnType],
    label: filedReturnsCapability(returnType).label,
    signalSlug: filedReturnsSafeSlug(returnType),
  };
}

export function filedReturnScopeId(returnType: FiledReturnsReturnType): string {
  return filedReturnsScopeId(returnType);
}

export function filedReturnScopedSignal(
  returnType: FiledReturnsReturnType,
  suffix: string,
): string {
  return `filed-${filedReturnsSafeSlug(returnType)}-${suffix}`;
}

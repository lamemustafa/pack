import {
  filedReturnsSafeSlug,
  filedReturnsScopeId,
  type FiledReturnsReturnType,
} from "../../core/filed-returns-return-types";

export interface FiledReturnDescriptor {
  returnType: FiledReturnsReturnType;
  label: FiledReturnsReturnType;
  scopeId: string;
  signalSlug: string;
  detailRoutePattern: RegExp;
  detailHeadingPattern: RegExp;
  explicitDownloadPattern: RegExp;
  excelDownloadPattern?: RegExp;
  secondaryDownloadPattern?: RegExp;
  systemGeneratedPattern?: RegExp;
  supportsDirectDownload: boolean;
}

export const FILED_RETURN_DESCRIPTORS: Record<FiledReturnsReturnType, FiledReturnDescriptor> = {
  "GSTR-3B": {
    returnType: "GSTR-3B",
    label: "GSTR-3B",
    scopeId: filedReturnsScopeId("GSTR-3B"),
    signalSlug: filedReturnsSafeSlug("GSTR-3B"),
    detailRoutePattern: /\/returns\/auth\/gstr3b$/i,
    detailHeadingPattern: /\bgstr[\s-]?3b\s*-\s*monthly\s+return\b/i,
    explicitDownloadPattern: /\bdownload\s+filed\s+gstr[\s-]?3b\b/i,
    systemGeneratedPattern: /\bsystem\s+generated\b.*\bgstr[\s-]?3b\b/i,
    supportsDirectDownload: true,
  },
  "GSTR-1": {
    returnType: "GSTR-1",
    label: "GSTR-1",
    scopeId: filedReturnsScopeId("GSTR-1"),
    signalSlug: filedReturnsSafeSlug("GSTR-1"),
    detailRoutePattern: /\/returns\/auth\/gstr1(?:\/|$)/i,
    detailHeadingPattern: /\bgstr[\s-]?1\b/i,
    explicitDownloadPattern: /\bdownload\s+filed\s+gstr[\s-]?1\b/i,
    excelDownloadPattern:
      /\bdownload\b.*\b(?:details?\b.*\b(?:e-?invoices?|excel)|excel\b.*\b(?:details?|e-?invoices?))\b/i,
    secondaryDownloadPattern: /\bdownload\s*\(?\s*pdf\s*\)?\b/i,
    supportsDirectDownload: false,
  },
};

export function filedReturnDescriptor(returnType: FiledReturnsReturnType): FiledReturnDescriptor {
  return FILED_RETURN_DESCRIPTORS[returnType];
}

export function filedReturnScopeId(returnType: FiledReturnsReturnType): string {
  return filedReturnDescriptor(returnType).scopeId;
}

export function filedReturnScopedSignal(
  returnType: FiledReturnsReturnType,
  suffix: string,
): string {
  return `filed-${filedReturnDescriptor(returnType).signalSlug}-${suffix}`;
}

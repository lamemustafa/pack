import { FILED_RETURNS_CAPABILITIES } from "./filed-returns-capabilities.ts";

export const FILED_RETURNS_RETURN_TYPES = ["GSTR-3B", "GSTR-1", "GSTR-2B"] as const;

export type FiledReturnsReturnType = (typeof FILED_RETURNS_RETURN_TYPES)[number];

export function isFiledReturnsReturnType(input: unknown): input is FiledReturnsReturnType {
  return (
    typeof input === "string" &&
    FILED_RETURNS_RETURN_TYPES.includes(input as FiledReturnsReturnType)
  );
}

/**
 * The returns public Store copy advertises. A subset of FILED_RETURNS_RETURN_TYPES by
 * construction -- it is filtered from it -- so copy can never name a return Pack does
 * not implement, and a return can be implemented ahead of its public claim.
 */
export function storeAdvertisedFiledReturnsReturnTypes(): FiledReturnsReturnType[] {
  return FILED_RETURNS_RETURN_TYPES.filter(
    (type) => FILED_RETURNS_CAPABILITIES[type].storeAdvertised,
  );
}

export function supportsFullFiscalYearFiledReturnsRun(returnType: FiledReturnsReturnType): boolean {
  return FILED_RETURNS_CAPABILITIES[returnType].fullFiscalYear;
}

export function filedReturnsScopeId(returnType: FiledReturnsReturnType): string {
  return FILED_RETURNS_CAPABILITIES[returnType].scopeId;
}

export function filedReturnsSafeSlug(returnType: FiledReturnsReturnType): string {
  return returnType.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

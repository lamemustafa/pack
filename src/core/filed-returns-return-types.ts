export const FILED_RETURNS_RETURN_TYPES = ["GSTR-3B", "GSTR-1"] as const;

export type FiledReturnsReturnType = (typeof FILED_RETURNS_RETURN_TYPES)[number];

export function isFiledReturnsReturnType(input: unknown): input is FiledReturnsReturnType {
  return (
    typeof input === "string" &&
    FILED_RETURNS_RETURN_TYPES.includes(input as FiledReturnsReturnType)
  );
}

export function supportsFullFiscalYearFiledReturnsRun(returnType: FiledReturnsReturnType): boolean {
  return returnType === "GSTR-3B" || returnType === "GSTR-1";
}

export function filedReturnsScopeId(returnType: FiledReturnsReturnType): string {
  return returnType === "GSTR-3B"
    ? "gst-filed-returns-gstr3b-pdf-private-v0"
    : "gst-filed-returns-gstr1-pdf-private-v0";
}

export function filedReturnsSafeSlug(returnType: FiledReturnsReturnType): string {
  return returnType.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

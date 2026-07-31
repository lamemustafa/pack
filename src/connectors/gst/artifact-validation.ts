export type ArtifactValidationResult =
  | {
      ok: true;
      mimeType:
        | "application/pdf"
        | "application/json"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
  | { ok: false; reason: "empty" | "too-large" | "unexpected-content" | "target-period-mismatch" };

const MIN_PDF_BYTES = 1024;
const MIN_JSON_BYTES = 100;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
const XLSX_MAGIC = [0x50, 0x4b];

export function validateArtifactBytes(
  bytes: Uint8Array,
  artifactType: "PDF" | "JSON" | "EXCEL",
  expectedReturnPeriod: string,
  returnType: "GSTR-3B" | "GSTR-2B" | "GSTR-1" = "GSTR-3B",
): ArtifactValidationResult {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) return { ok: false, reason: "too-large" };
  if (artifactType === "PDF") {
    if (
      bytes.byteLength < MIN_PDF_BYTES ||
      !PDF_MAGIC.every((value, index) => bytes[index] === value)
    ) {
      return { ok: false, reason: "unexpected-content" };
    }
    return { ok: true, mimeType: "application/pdf" };
  }
  if (artifactType === "EXCEL") {
    if (
      bytes.byteLength < MIN_PDF_BYTES ||
      !XLSX_MAGIC.every((value, index) => bytes[index] === value)
    ) {
      return { ok: false, reason: "unexpected-content" };
    }
    return {
      ok: true,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  if (bytes.byteLength < MIN_JSON_BYTES) return { ok: false, reason: "unexpected-content" };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      status?: unknown;
      data?: { r3b?: { ret_period?: unknown }; ret_period?: unknown; rtnprd?: unknown };
    };
    const actualPeriod =
      returnType === "GSTR-2B"
        ? parsed.data?.rtnprd
        : returnType === "GSTR-1"
          ? parsed.data?.ret_period
          : parsed.status === 1
            ? parsed.data?.r3b?.ret_period
            : null;
    if (typeof actualPeriod !== "string") return { ok: false, reason: "unexpected-content" };
    return actualPeriod === expectedReturnPeriod
      ? { ok: true, mimeType: "application/json" }
      : { ok: false, reason: "target-period-mismatch" };
  } catch {
    return { ok: false, reason: "unexpected-content" };
  }
}

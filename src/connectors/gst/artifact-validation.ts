export type ArtifactValidationResult =
  | { ok: true; mimeType: "application/pdf" | "application/json" }
  | { ok: false; reason: "empty" | "too-large" | "unexpected-content" | "target-period-mismatch" };

const MIN_PDF_BYTES = 1024;
const MIN_JSON_BYTES = 100;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function validateArtifactBytes(
  bytes: Uint8Array,
  artifactType: "PDF" | "JSON",
  expectedReturnPeriod: string,
): ArtifactValidationResult {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) return { ok: false, reason: "too-large" };
  if (artifactType === "PDF") {
    if (bytes.byteLength < MIN_PDF_BYTES || !PDF_MAGIC.every((value, index) => bytes[index] === value)) {
      return { ok: false, reason: "unexpected-content" };
    }
    return { ok: true, mimeType: "application/pdf" };
  }
  if (bytes.byteLength < MIN_JSON_BYTES) return { ok: false, reason: "unexpected-content" };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      status?: unknown;
      data?: { r3b?: { ret_period?: unknown } };
    };
    if (parsed.status !== 1) return { ok: false, reason: "unexpected-content" };
    return parsed.data?.r3b?.ret_period === expectedReturnPeriod
      ? { ok: true, mimeType: "application/json" }
      : { ok: false, reason: "target-period-mismatch" };
  } catch {
    return { ok: false, reason: "unexpected-content" };
  }
}

import type { FiledReturnsReturnType } from "./filed-returns-return-types";

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
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
const XLSX_MAGIC = [0x50, 0x4b];

export interface FiledReturnsJsonDocumentContract {
  envelopePath: readonly string[];
  requiredStatus?: number;
  returnPeriodKey: "ret_period" | "rtnprd";
}

const FILED_RETURNS_JSON_DOCUMENT_CONTRACTS: Readonly<
  Record<FiledReturnsReturnType, FiledReturnsJsonDocumentContract>
> = {
  "GSTR-1": { envelopePath: ["data"], returnPeriodKey: "ret_period" },
  "GSTR-2B": { envelopePath: ["data"], returnPeriodKey: "rtnprd" },
  "GSTR-3B": { envelopePath: ["data", "r3b"], requiredStatus: 1, returnPeriodKey: "ret_period" },
};

export function filedReturnsJsonDocumentContract(
  returnType: FiledReturnsReturnType,
): FiledReturnsJsonDocumentContract {
  return FILED_RETURNS_JSON_DOCUMENT_CONTRACTS[returnType];
}

export function validateArtifactBytes(
  bytes: Uint8Array,
  artifactType: "PDF" | "JSON" | "EXCEL",
  expectedReturnPeriod: string,
  returnType: FiledReturnsReturnType = "GSTR-3B",
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
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const contract = filedReturnsJsonDocumentContract(returnType);
    const document = jsonObjectAtPath(parsed, contract.envelopePath);
    const statusMatches =
      contract.requiredStatus === undefined ||
      (isJsonObject(parsed) && parsed.status === contract.requiredStatus);
    const actualPeriod = statusMatches ? document?.[contract.returnPeriodKey] : null;
    if (typeof actualPeriod !== "string") return { ok: false, reason: "unexpected-content" };
    return actualPeriod === expectedReturnPeriod
      ? { ok: true, mimeType: "application/json" }
      : { ok: false, reason: "target-period-mismatch" };
  } catch {
    return { ok: false, reason: "unexpected-content" };
  }
}

function jsonObjectAtPath(input: unknown, path: readonly string[]): Record<string, unknown> | null {
  let current = input;
  for (const segment of path) {
    if (!isJsonObject(current)) return null;
    current = current[segment];
  }
  return isJsonObject(current) ? current : null;
}

function isJsonObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

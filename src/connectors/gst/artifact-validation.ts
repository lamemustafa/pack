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
  // No size floor. A filed return with nothing in it has a legitimately compact summary envelope,
  // and a byte count cannot tell that apart from a truncated response -- captured live on
  // 2026-09-10, where a valid April envelope under 100 bytes was refused before anything read it.
  // Every case the floor was standing in for is caught below and caught better: an empty body is
  // rejected above, a non-JSON body fails to parse, and a body too small to hold the envelope
  // fails the envelope and period checks that follow.
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

// Why a JSON artifact was refused, as signal fragments safe to show and to persist.
//
// `validateArtifactBytes` returns a category, and two different failures share the
// `unexpected-content` category: a body that is not the expected envelope, and one whose period
// field is absent. Diagnosing a live refusal from outside the browser needs the difference, and a
// guard that cannot say which condition fired costs a round trip every time it fires.
//
// Everything here is a shape fact -- byte count band, field presence, parse success. No field
// value is included, so nothing taxpayer-identifying can reach a signal.
export function describeJsonArtifactRejection(
  bytes: Uint8Array,
  expectedReturnPeriod: string,
  returnType: FiledReturnsReturnType,
): string[] {
  if (bytes.byteLength === 0) return ["json-body-empty"];
  // Report the size band and keep going. Stopping here says only that the body is small, which
  // cannot distinguish a legitimately compact envelope from a truncated or unrelated response --
  // and that distinction is the whole question when a return has nothing in it.
  const signals: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return [...signals, "json-parse-failed"];
  }
  const contract = filedReturnsJsonDocumentContract(returnType);
  if (contract.requiredStatus !== undefined) {
    const statusMatches = isJsonObject(parsed) && parsed.status === contract.requiredStatus;
    if (!statusMatches) return [...signals, "json-status-unexpected"];
  }
  const document = jsonObjectAtPath(parsed, contract.envelopePath);
  if (!document) return [...signals, "json-envelope-missing"];
  const actualPeriod = document[contract.returnPeriodKey];
  if (typeof actualPeriod !== "string") return [...signals, "json-period-field-missing"];
  // A small body that still satisfies the contract is the case the size floor gets wrong, and
  // this signal is what says so.
  return actualPeriod === expectedReturnPeriod
    ? [...signals, "json-contract-satisfied"]
    : [...signals, "json-period-mismatch"];
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

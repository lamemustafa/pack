import { canonicalJsonPointerSegments } from "../../core/json-flat-table";
import { filedReturnsJsonDocumentContract } from "./artifact-validation";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";

const SCALAR_WRAPPER_SEGMENT = "value";

export const FILED_RETURNS_GSTR3B_WORKBOOK_IDENTITY_LABELS = ["GSTIN", "Legal name"] as const;
export type FiledReturnsGstr3bWorkbookIdentityLabel =
  (typeof FILED_RETURNS_GSTR3B_WORKBOOK_IDENTITY_LABELS)[number];

export interface FiledReturnsSummaryIdentity {
  contextType: "taxpayer_identity" | "return_identity";
  label: string;
}

// Where the captured GSTR-3B preflight response puts each required identity:
// `gstin` inside the return envelope, `lglnm` in the document object that holds
// the envelope. The envelope itself is read from the JSON document contract so
// this does not restate `/data/r3b`.
const GSTR3B_CANONICAL_IDENTITY_KEYS: Readonly<
  Record<
    FiledReturnsGstr3bWorkbookIdentityLabel,
    { container: "document" | "envelope"; key: string }
  >
> = {
  GSTIN: { container: "envelope", key: "gstin" },
  "Legal name": { container: "document", key: "lglnm" },
};

/**
 * The canonical response path each required workbook identity must come from.
 * Requiring the exact pointer, rather than the label anywhere in the document,
 * stops an outer or metadata identity standing in for the filed return's own
 * and having the workbook attribute that return's figures to it.
 */
export function filedReturnsRequiredWorkbookIdentityPaths(
  returnType: FiledReturnsReturnType,
): ReadonlyMap<FiledReturnsGstr3bWorkbookIdentityLabel, string> {
  if (returnType !== "GSTR-3B") return new Map();
  const envelopePath = filedReturnsJsonDocumentContract(returnType).envelopePath;
  return new Map(
    FILED_RETURNS_GSTR3B_WORKBOOK_IDENTITY_LABELS.map((label) => {
      const { container, key } = GSTR3B_CANONICAL_IDENTITY_KEYS[label];
      const containerPath = container === "envelope" ? envelopePath : envelopePath.slice(0, -1);
      return [label, `${containerPath.map((segment) => `/${segment}`).join("")}/${key}`];
    }),
  );
}

export function filedReturnsSummaryIdentityLabel(path: string): string | null {
  return filedReturnsSummaryIdentity(path)?.label ?? null;
}

export function filedReturnsSummaryIdentity(path: string): FiledReturnsSummaryIdentity | null {
  const segments = canonicalJsonPointerSegments(path);
  const terminalIdentity = identityForCanonicalSegment(segments.at(-1) ?? "");
  if (terminalIdentity) return terminalIdentity;
  if (segments.at(-1) === SCALAR_WRAPPER_SEGMENT) {
    return identityForCanonicalSegment(segments.at(-2) ?? "");
  }
  return null;
}

/**
 * Whether a leaf path is the canonical response path for a required identity.
 * Compared on canonical segments, and through the same scalar wrapper this
 * module already accepts elsewhere, so casing and a `{ value: … }` wrapper at
 * the canonical location still match while a same-named leaf anywhere else in
 * the document does not.
 */
export function isFiledReturnsCanonicalIdentityPath(path: string, canonicalPath: string): boolean {
  const segments = canonicalJsonPointerSegments(path);
  const unwrapped = segments.at(-1) === SCALAR_WRAPPER_SEGMENT ? segments.slice(0, -1) : segments;
  const canonical = canonicalJsonPointerSegments(canonicalPath);
  return (
    unwrapped.length === canonical.length &&
    unwrapped.every((segment, index) => segment === canonical[index])
  );
}

/**
 * Whether a leaf path is identity, for redaction. Every contiguous run of
 * canonical segments is tested, not each segment alone: a compound alias the
 * registry knows as one word can arrive split across a container boundary, so
 * `{"taxpayer":{"name":"…"}}` is `/taxpayer/name` and neither segment matches
 * `taxpayername` on its own.
 *
 * This is deliberately broader than `filedReturnsSummaryIdentity`, which stays
 * terminal-specific because it names the identity for extraction. Redaction
 * must fail closed; labelling must be exact.
 */
export function isFiledReturnsSummaryIdentityPath(path: string): boolean {
  const segments = canonicalJsonPointerSegments(path);
  return segments.some((_, start) =>
    segments.some(
      (_ignored, end) =>
        identityForCanonicalSegment(segments.slice(start, end + 1).join("")) !== null,
    ),
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

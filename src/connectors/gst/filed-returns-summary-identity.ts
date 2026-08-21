import {
  canonicalJsonPointerSegments,
  decodedJsonPointerSegments,
} from "../../core/json-flat-table";
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

/**
 * Finds an identity that belongs to the return owner, rather than a similarly
 * named value inside a supplier record. Extraction names the taxpayer in the
 * context rows and seeds value redaction, so it must be bound to the owner
 * container declared by the return type's JSON contract.
 */
export function filedReturnsSummaryIdentity(
  returnType: FiledReturnsReturnType,
  path: string,
): FiledReturnsSummaryIdentity | null {
  const segments = canonicalJsonPointerSegments(path);
  const unwrapped = segments.at(-1) === SCALAR_WRAPPER_SEGMENT ? segments.slice(0, -1) : segments;
  for (const ownerContainer of ownerIdentityContainerPaths(returnType)) {
    if (
      unwrapped.length <= ownerContainer.length ||
      !ownerContainer.every((segment, index) => segment === unwrapped[index])
    ) {
      continue;
    }
    const identity = identityForCanonicalSegment(unwrapped.slice(ownerContainer.length).join(""));
    if (
      identity &&
      ownerIdentityContainerPathsForIdentity(returnType, identity).some((expectedOwnerContainer) =>
        pathsMatch(expectedOwnerContainer, ownerContainer),
      )
    ) {
      return identity;
    }
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
 * owner-scoped because it names the identity for extraction. Redaction must
 * fail closed; labelling must be exact. A trade name is reportable only with
 * positive counterparty evidence, never because owner evidence is absent.
 */
export function isFiledReturnsSummaryIdentityPath(
  returnType: FiledReturnsReturnType,
  path: string,
  counterpartyRecordPaths: ReadonlySet<string> = new Set(),
): boolean {
  return identityCandidates(path).some(
    ({ identity, recordPath }) =>
      identity.label !== "Trade name" ||
      !hasPositiveCounterpartyTradeNameEvidence(returnType, recordPath, counterpartyRecordPaths),
  );
}

/**
 * Whether a scalar can seed the own-identity value redaction net. This admits
 * every recognised identity candidate, including an ambiguously placed trade
 * name, so the value net remains broader than owner-context extraction.
 */
export function isFiledReturnsSummaryIdentityCandidatePath(path: string): boolean {
  return identityCandidates(path).length > 0;
}

/**
 * Returns the canonical path of a non-owner record with a direct `ctin` field.
 * A sibling `trdnm` in that record has affirmative counterparty evidence.
 */
/**
 * True when the leaf IS a recognised identity, rather than metadata beside one.
 *
 * Accepts the identity's own scalar and the single supported wrapper shape, and
 * rejects any deeper property of an object-shaped identity. Path redaction can
 * afford to be broad; the values that seed cross-document redaction cannot, or
 * `/data/gstin/status: "Active"` teaches Pack to delete every "Active" it sees.
 */
export function isFiledReturnsSummaryIdentityScalarPath(path: string): boolean {
  const segments = canonicalJsonPointerSegments(path);
  const unwrapped = unwrapScalarPath(segments);
  // A contiguous run ENDING at the terminal segment, so a split alias like
  // `/data/trade/name` still composes to `tradename` and still seeds redaction.
  // `/data/gstin/status` has no such run -- neither `status` nor `gstinstatus`
  // is an alias -- so identity metadata does not.
  return unwrapped.some(
    (_, start) => identityForCanonicalSegment(unwrapped.slice(start).join("")) !== null,
  );
}

export function filedReturnsSummaryCounterpartyRecordPath(
  returnType: FiledReturnsReturnType,
  path: string,
): string | null {
  const canonical = unwrapScalarPath(canonicalJsonPointerSegments(path));
  if (canonical.at(-1) !== "ctin") return null;
  // The RECORD is identified by its exact decoded segments. Folding them would
  // let a valid ctin under `supplier-one` vouch for a trdnm under
  // `supplier_one`, releasing a value that record never proved anything about.
  const exact = unwrapScalarPath(decodedJsonPointerSegments(path));
  const recordPath = exact.slice(0, -1);
  return ownerIdentityContainerPaths(returnType).some((ownerPath) =>
    pathsMatch(ownerPath, canonical.slice(0, -1)),
  )
    ? null
    : recordPath.join("/");
}

function ownerIdentityContainerPath(
  returnType: FiledReturnsReturnType,
  identity: FiledReturnsSummaryIdentity,
): readonly string[] {
  const envelopePath = filedReturnsJsonDocumentContract(returnType).envelopePath;
  // GSTR-3B keeps its GSTIN inside the return envelope while its remaining
  // owner/filing identity sits beside that envelope. GSTR-1 and GSTR-2B have a
  // one-segment envelope, which is itself their owner container. This derives
  // every location from the document contract instead of restating pointers.
  return identity.label === "GSTIN" || envelopePath.length === 1
    ? envelopePath
    : envelopePath.slice(0, -1);
}

function ownerIdentityContainerPaths(
  returnType: FiledReturnsReturnType,
): readonly (readonly string[])[] {
  const envelopePath = filedReturnsJsonDocumentContract(returnType).envelopePath;
  const documentPath = envelopePath.length === 1 ? envelopePath : envelopePath.slice(0, -1);
  return pathsMatch(documentPath, envelopePath) ? [envelopePath] : [envelopePath, documentPath];
}

function ownerIdentityContainerPathsForIdentity(
  returnType: FiledReturnsReturnType,
  identity: FiledReturnsSummaryIdentity,
): readonly (readonly string[])[] {
  const ownerPath = ownerIdentityContainerPath(returnType, identity);
  const envelopePath = filedReturnsJsonDocumentContract(returnType).envelopePath;
  // GSTR-3B has captured owner trade names both beside and inside its return
  // envelope. This keeps context extraction precise without treating wrappers
  // or supplier records as owner identity.
  return identity.label === "Trade name" && !pathsMatch(ownerPath, envelopePath)
    ? [ownerPath, envelopePath]
    : [ownerPath];
}

function hasPositiveCounterpartyTradeNameEvidence(
  returnType: FiledReturnsReturnType,
  recordPath: readonly string[],
  counterpartyRecordPaths: ReadonlySet<string>,
): boolean {
  return (
    declaredCounterpartyContainerPaths(returnType).some((containerPath) =>
      containerPath.every((segment, index) => segment === recordPath[index]),
    ) || counterpartyRecordPaths.has(recordPath.join("/"))
  );
}

function declaredCounterpartyContainerPaths(
  returnType: FiledReturnsReturnType,
): readonly (readonly string[])[] {
  // The captured GSTR-2B contract declares b2b records as counterparties. It
  // is affirmative structural evidence even when the array is collapsed to a
  // count rather than expanded into CSV rows.
  // Exact segments: `/data/doc-data/b2b` is a different container.
  return returnType === "GSTR-2B" ? [["data", "docdata", "b2b"]] : [];
}

function identityCandidates(
  path: string,
): readonly { identity: FiledReturnsSummaryIdentity; recordPath: readonly string[] }[] {
  const segments = unwrapScalarPath(canonicalJsonPointerSegments(path));
  // Aliases are matched canonically; the record prefix is kept exact, so
  // evidence recorded for one sibling cannot vouch for a punctuation-distinct
  // one. Both arrays index the same segments.
  const exact = unwrapScalarPath(decodedJsonPointerSegments(path));
  const candidates: { identity: FiledReturnsSummaryIdentity; recordPath: readonly string[] }[] = [];
  for (let start = 0; start < segments.length; start += 1) {
    for (let end = start; end < segments.length; end += 1) {
      const identity = identityForCanonicalSegment(segments.slice(start, end + 1).join(""));
      if (identity) candidates.push({ identity, recordPath: exact.slice(0, start) });
    }
  }
  return candidates;
}

function unwrapScalarPath(segments: readonly string[]): readonly string[] {
  return segments.at(-1) === SCALAR_WRAPPER_SEGMENT ? segments.slice(0, -1) : segments;
}

function pathsMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
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

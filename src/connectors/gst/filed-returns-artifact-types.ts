/**
 * The artifact vocabulary, and nothing else.
 *
 * This is a leaf on purpose. `filed-returns-artifacts.ts` and `filed-returns-capabilities.ts`
 * each need these names, and each needs functions from the other, so holding the vocabulary
 * in either of them formed a runtime import cycle. That cycle was safe only for as long as
 * nobody wrote a top-level `const` derived across it: `scripts/create-live-run-evidence-template.mjs`
 * loads this graph through real Node ESM, where such a const throws on a temporal-dead-zone
 * access — and `tsc` would not have caught it, because tsc resolves like a bundler.
 *
 * Do not import anything here. A single import turns this leaf back into the cycle it
 * replaced. The public surface stays `filed-returns-artifacts.ts`, which re-exports these,
 * so callers are unaffected.
 *
 * The `.ts` extensions on relative imports of this module are required, not stylistic —
 * Node's resolver has no extensionless fallback under --experimental-strip-types.
 */

export const FILED_RETURNS_ARTIFACT_TYPES = ["PDF", "JSON", "EXCEL", "PDF_AND_EXCEL"] as const;
// Order matters: it is the sequence artifacts are fetched and written into a
// bundle. It matches the sequence the product has always shipped and that live
// runs exercised. Two hardcoded copies of "all formats" used to carry this order
// separately; both now derive from here, so this is the only place to change it.
export const FILED_RETURNS_CONCRETE_ARTIFACT_TYPES = ["PDF", "EXCEL", "JSON"] as const;

export type FiledReturnsArtifactType = (typeof FILED_RETURNS_ARTIFACT_TYPES)[number];
export type FiledReturnsConcreteArtifactType =
  (typeof FILED_RETURNS_CONCRETE_ARTIFACT_TYPES)[number];
export type FiledReturnsArtifactExtension = ".pdf" | ".json" | ".xls" | ".xlsx";

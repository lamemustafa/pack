// The `.ts` extensions on relative imports in this module and its siblings are
// required, not stylistic. `scripts/create-live-run-evidence-template.mjs` loads
// this graph with a real Node ESM `await import("....ts")` under
// --experimental-strip-types, and Node's resolver has no extensionless fallback:
// dropping them fails at runtime with ERR_MODULE_NOT_FOUND while `tsc` still
// passes, because tsc resolves like a bundler. Ten tests catch it.
//
// This module is the public surface for artifact names and behaviour. The vocabulary
// itself lives in the leaf `filed-returns-artifact-types.ts` and is re-exported here, so
// that this module and `filed-returns-capabilities.ts` form a one-way edge rather than
// the cycle they used to. See that leaf for why the cycle mattered.
import {
  FILED_RETURNS_ARTIFACT_TYPES,
  FILED_RETURNS_CONCRETE_ARTIFACT_TYPES,
} from "./filed-returns-artifact-types.ts";
import type {
  FiledReturnsArtifactExtension,
  FiledReturnsArtifactType,
  FiledReturnsConcreteArtifactType,
} from "./filed-returns-artifact-types.ts";
import {
  filedReturnsCapabilityArtifactLabel,
  filedReturnsFormat,
  filedReturnsOfferedArtifacts,
} from "./filed-returns-capabilities.ts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export { FILED_RETURNS_ARTIFACT_TYPES, FILED_RETURNS_CONCRETE_ARTIFACT_TYPES };
export type {
  FiledReturnsArtifactExtension,
  FiledReturnsArtifactType,
  FiledReturnsConcreteArtifactType,
};

export function isFiledReturnsArtifactType(input: unknown): input is FiledReturnsArtifactType {
  return (
    typeof input === "string" &&
    FILED_RETURNS_ARTIFACT_TYPES.includes(input as FiledReturnsArtifactType)
  );
}

export function isFiledReturnsConcreteArtifactType(
  input: unknown,
): input is FiledReturnsConcreteArtifactType {
  return (
    typeof input === "string" &&
    FILED_RETURNS_CONCRETE_ARTIFACT_TYPES.includes(input as FiledReturnsConcreteArtifactType)
  );
}

export function supportsFiledReturnsArtifactType(
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsArtifactType,
): boolean {
  const offered = filedReturnsOfferedArtifacts(returnType);
  if (artifactType === "PDF_AND_EXCEL") {
    // The combined selection is literally PDF plus Excel. GSTR-3B offers two artifacts
    // (PDF and portal data) but no Excel, so it must not qualify.
    return offered.includes("PDF") && offered.includes("EXCEL");
  }
  return offered.includes(artifactType);
}

export function normaliseFiledReturnsArtifactType(
  returnType: FiledReturnsReturnType,
  artifactType: unknown = "PDF",
): FiledReturnsArtifactType {
  const candidate = isFiledReturnsArtifactType(artifactType) ? artifactType : "PDF";
  return supportsFiledReturnsArtifactType(returnType, candidate) ? candidate : "PDF";
}

export function concreteFiledReturnsArtifactTypes(
  artifactType: FiledReturnsArtifactType | undefined,
): FiledReturnsConcreteArtifactType[] {
  if (artifactType === "PDF_AND_EXCEL") return ["PDF", "EXCEL"];
  if (artifactType === "EXCEL") return ["EXCEL"];
  if (artifactType === "JSON") return ["JSON"];
  return ["PDF"];
}

export function concreteFiledReturnsArtifactTypesForSelection(
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsArtifactType | undefined,
): FiledReturnsConcreteArtifactType[] {
  const selectedArtifactType = normaliseFiledReturnsArtifactType(returnType, artifactType);
  if (returnType === "GSTR-2B" && selectedArtifactType === "PDF_AND_EXCEL") {
    return ["PDF", "EXCEL", "JSON"];
  }
  return concreteFiledReturnsArtifactTypes(selectedArtifactType);
}

export function filedReturnsArtifactLabel(
  artifactType: FiledReturnsArtifactType,
  returnType?: FiledReturnsReturnType,
): string {
  if (!returnType) return artifactType === "PDF_AND_EXCEL" ? "All formats" : artifactType;
  return filedReturnsCapabilityArtifactLabel(returnType, artifactType);
}

export function filedReturnsConcreteArtifactLabel(
  artifactType: FiledReturnsConcreteArtifactType,
  returnType?: FiledReturnsReturnType,
): string {
  if (!returnType) return artifactType;
  return filedReturnsCapabilityArtifactLabel(returnType, artifactType);
}

export function filedReturnsArtifactExtension(
  artifactType: FiledReturnsConcreteArtifactType,
): FiledReturnsArtifactExtension {
  return filedReturnsFormat(artifactType).extension;
}

export function filedReturnsArtifactMimeTypes(
  artifactType: FiledReturnsConcreteArtifactType,
): string[] {
  return [...filedReturnsFormat(artifactType).mimeTypes];
}

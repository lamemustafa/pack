// Imports the artifact vocabulary from its leaf, never from `filed-returns-artifacts.ts`:
// that module imports this one, so reaching back through it would re-form a runtime cycle.
import { FILED_RETURNS_CONCRETE_ARTIFACT_TYPES } from "./filed-returns-artifact-types.ts";
import type {
  FiledReturnsArtifactExtension,
  FiledReturnsArtifactType,
  FiledReturnsConcreteArtifactType,
} from "./filed-returns-artifact-types.ts";
import { FILED_RETURNS_CAPABILITIES } from "./filed-returns-catalogue.ts";
import type {
  FiledReturnsSupportedReturnType,
  SupportedReturnTypeCapability,
} from "./filed-returns-catalogue.ts";

export {
  FILED_RETURNS_CAPABILITIES,
  FILED_RETURNS_PERIODICITIES,
  filedReturnsCatalogueEntries,
  supportedFiledReturnsCatalogueEntries,
} from "./filed-returns-catalogue.ts";
export type {
  FiledReturnsCatalogueEntry,
  FiledReturnsCatalogueReturnType,
  FiledReturnsPeriodicity,
  FiledReturnsSupportStatus,
  FiledReturnsSupportedCatalogueEntry,
  FiledReturnsSupportedReturnType,
  SupportedReturnTypeCapability,
} from "./filed-returns-catalogue.ts";

export function filedReturnsCapability(
  returnType: FiledReturnsSupportedReturnType,
): SupportedReturnTypeCapability {
  return FILED_RETURNS_CAPABILITIES[returnType] as SupportedReturnTypeCapability;
}

/** The concrete artifacts this return offers, in canonical format order. */
export function filedReturnsOfferedArtifacts(
  returnType: FiledReturnsSupportedReturnType,
): FiledReturnsConcreteArtifactType[] {
  const artifacts = filedReturnsCapability(returnType).artifacts;
  return FILED_RETURNS_CONCRETE_ARTIFACT_TYPES.filter((artifactType) => artifacts[artifactType]);
}

export function filedReturnsUnavailableReason(
  returnType: FiledReturnsSupportedReturnType,
  artifactType: FiledReturnsConcreteArtifactType,
): string | null {
  if (filedReturnsCapability(returnType).artifacts[artifactType]) return null;
  return `The portal does not offer ${artifactType === "JSON" ? "portal data" : artifactType} for ${returnType}.`;
}

export function filedReturnsCapabilityArtifactLabel(
  returnType: FiledReturnsSupportedReturnType,
  artifactType: FiledReturnsArtifactType,
): string {
  const capability = filedReturnsCapability(returnType);
  if (artifactType === "PDF_AND_EXCEL") return capability.bundleLabel;
  return capability.artifacts[artifactType]?.label ?? artifactType;
}

export function filedReturnsCapabilityArtifactDescription(
  returnType: FiledReturnsSupportedReturnType,
  artifactType: FiledReturnsArtifactType,
): string {
  const capability = filedReturnsCapability(returnType);
  if (artifactType === "PDF_AND_EXCEL") return capability.bundleDescription;
  return capability.artifacts[artifactType]?.description ?? "";
}

export function filedReturnsCapabilitySummary(returnType: FiledReturnsSupportedReturnType): string {
  return filedReturnsCapability(returnType).summary;
}

/** Extension and MIME are properties of the file format, not of the return type. */
const ARTIFACT_FORMATS: Readonly<
  Record<
    FiledReturnsConcreteArtifactType,
    { extension: FiledReturnsArtifactExtension; mimeTypes: readonly string[] }
  >
> = {
  PDF: { extension: ".pdf", mimeTypes: ["application/pdf"] },
  JSON: { extension: ".json", mimeTypes: ["application/json"] },
  EXCEL: {
    extension: ".xlsx",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
  },
};

export function filedReturnsFormat(artifactType: FiledReturnsConcreteArtifactType): {
  extension: FiledReturnsArtifactExtension;
  mimeTypes: readonly string[];
} {
  return ARTIFACT_FORMATS[artifactType];
}

export function filedReturnsCapabilitySentenceSubject(
  returnType: FiledReturnsSupportedReturnType,
  artifactType: FiledReturnsArtifactType,
  fullFiscalYear: boolean,
): string {
  const capability = filedReturnsCapability(returnType);
  if (artifactType === "PDF_AND_EXCEL") {
    const noun = fullFiscalYear ? capability.bundleFullYearNoun : capability.bundleNoun;
    return `${returnType} ${noun}`;
  }
  const artifact = capability.artifacts[artifactType];
  if (!artifact) return `${returnType} ${artifactType}`;
  const noun = fullFiscalYear ? artifact.fullYearNoun : artifact.sentenceNoun;
  return artifact.standsAlone ? noun : `${returnType} ${noun}`;
}

const NO_RUN_NOTES: readonly string[] = [];

export function filedReturnsCapabilityRunNotes(
  returnType: FiledReturnsSupportedReturnType,
  artifactType: FiledReturnsArtifactType,
): readonly string[] {
  return filedReturnsCapability(returnType).runNotes[artifactType] ?? NO_RUN_NOTES;
}

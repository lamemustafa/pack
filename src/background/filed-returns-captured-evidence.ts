import type {
  BrowserDownloadSafeEvidence,
  FiledReturnsDownloadMimeClass,
} from "../connectors/gst/filed-returns-contracts";
import type { FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";

type CanonicalCapturedArtifactMimeClass = Extract<
  FiledReturnsDownloadMimeClass,
  "pdf" | "spreadsheet"
>;

export function validatedCapturedArtifactMimeClass(
  artifactType: FiledReturnsConcreteArtifactType,
): CanonicalCapturedArtifactMimeClass {
  return artifactType === "PDF" ? "pdf" : "spreadsheet";
}

/**
 * Use only after Pack has validated the captured data URL bytes, or while
 * reconciling the exact persisted download ID created by that validated path.
 * Chrome can classify an extension-owned Blob as generic or missing; retain
 * every other browser observation and replace only that non-specific MIME.
 */
export function withValidatedCapturedArtifactMime(
  safeEvidence: BrowserDownloadSafeEvidence | undefined,
  artifactType: FiledReturnsConcreteArtifactType,
): BrowserDownloadSafeEvidence | undefined {
  if (
    !safeEvidence ||
    (safeEvidence.mimeClass !== "generic-binary" && safeEvidence.mimeClass !== "missing")
  ) {
    return safeEvidence;
  }
  return {
    ...safeEvidence,
    mimeClass: validatedCapturedArtifactMimeClass(artifactType),
  };
}

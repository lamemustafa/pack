import type { FiledReturnsDownloadScope } from "../core/contracts";
import {
  concreteFiledReturnsArtifactTypes,
  filedReturnsArtifactExtension,
  normaliseFiledReturnsArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";

const SAFE_DOWNLOAD_ROOT = "complyeaze-pack/gst";

export function safeFiledReturnDownloadFilename(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  )[0] ?? "PDF",
): string {
  return [
    SAFE_DOWNLOAD_ROOT,
    safeFilenameSegment(scope.financialYear),
    safeFilenameSegment(scope.returnType),
    `${safeFilenameSegment(scope.period)}${filedReturnsArtifactExtension(artifactType)}`,
  ].join("/");
}

function safeFilenameSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

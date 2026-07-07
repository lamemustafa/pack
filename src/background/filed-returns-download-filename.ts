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

export function safeFiledReturnZipEntryPath(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
): string {
  return `${safeFilenameSegment(scope.period)}${filedReturnsArtifactExtension(artifactType)}`;
}

export function safeFullFiscalYearZipFilename(scope: FiledReturnsDownloadScope): string {
  return `${safeFilenameSegment(scope.returnType)}-${safeFilenameSegment(
    scope.financialYear,
  )}-full-year.zip`;
}

export function safeSinglePeriodZipFilename(scope: FiledReturnsDownloadScope): string {
  return `${safeFilenameSegment(scope.returnType)}-${safeFilenameSegment(
    scope.financialYear,
  )}-${safeFilenameSegment(scope.period)}.zip`;
}

function safeFilenameSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

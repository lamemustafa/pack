import type { FiledReturnsDownloadScope } from "../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypes,
  type FiledReturnsArtifactExtension,
  filedReturnsArtifactExtension,
  normaliseFiledReturnsArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../connectors/gst/filed-returns-artifacts";

const SAFE_DOWNLOAD_ROOT = "complyeaze-pack/gst";

export function safeFiledReturnDownloadFilename(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  )[0] ?? "PDF",
  extension: FiledReturnsArtifactExtension = filedReturnsArtifactExtension(artifactType),
): string {
  return [
    SAFE_DOWNLOAD_ROOT,
    safeFilenameSegment(scope.financialYear),
    safeFilenameSegment(scope.returnType),
    `${safeFilenameSegment(scope.period)}${extension}`,
  ].join("/");
}

export function safeFiledReturnZipEntryPath(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
  extension: FiledReturnsArtifactExtension = filedReturnsArtifactExtension(artifactType),
): string {
  const period = safeFilenameSegment(scope.period);
  if (artifactType === "JSON") return `${period}-data.json`;
  if (artifactType === "EXCEL") return `${period}-details${extension}`;
  return scope.returnType === "GSTR-3B" ? `${period}-return.pdf` : `${period}-summary.pdf`;
}

export function safeFullFiscalYearZipFilename(scope: FiledReturnsDownloadScope): string {
  return [...safeFiledReturnZipDirectory(scope), "full-year.zip"].join("/");
}

export function safeSinglePeriodZipFilename(scope: FiledReturnsDownloadScope): string {
  return [
    ...safeFiledReturnZipDirectory(scope),
    `${safeFilenameSegment(scope.period, false)}.zip`,
  ].join("/");
}

function safeFiledReturnZipDirectory(scope: FiledReturnsDownloadScope): string[] {
  return [
    "ComplyEaze-Pack",
    safeFilenameSegment(scope.financialYear),
    safeFilenameSegment(scope.returnType, false),
  ];
}

function safeFilenameSegment(value: string, lowercase = true): string {
  return (lowercase ? value.toLowerCase() : value)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

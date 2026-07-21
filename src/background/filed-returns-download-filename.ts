import type { FiledReturnsDownloadScope } from "../core/contracts";
import {
  concreteFiledReturnsArtifactTypes,
  type FiledReturnsArtifactExtension,
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
  return `${safeFilenameSegment(scope.period)}${extension}`;
}

export function safeFullFiscalYearZipFilename(
  scope: FiledReturnsDownloadScope,
  ledgerId: string,
): string {
  const periodName = scope.rangeEndPeriod
    ? `${safeFilenameSegment(scope.period)}-to-${safeFilenameSegment(scope.rangeEndPeriod)}`
    : "full-year";
  return [
    "ComplyEaze-Pack",
    `Archive-${safeArchiveCode(ledgerId)}`,
    `FY-${safeFilenameSegment(scope.financialYear)}`,
    scope.returnType,
    `${periodName}.zip`,
  ].join("/");
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

function safeArchiveCode(ledgerId: string): string {
  const code = ledgerId
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 12)
    .toUpperCase();
  return code.length >= 6 ? code : "LOCALRUN";
}

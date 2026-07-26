import type {
  FiledReturnsDownloadEndpointClass,
  FiledReturnsDownloadPathClass,
} from "./filed-returns-contracts";
import type { FiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export function isFiledReturnsEndpointClassForArtifact(
  endpointClass: FiledReturnsDownloadEndpointClass,
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  if (endpointClass === "unknown") return true;
  if (returnType === "GSTR-3B" && artifactType === "PDF") {
    return (
      endpointClass === "gstr3b-portal-rendered-download" ||
      endpointClass === "gstr3b-portal-blob-captured-download" ||
      endpointClass === "gstr3b-browser-managed-direct-download"
    );
  }
  if (returnType === "GSTR-1" && artifactType === "PDF") {
    return (
      endpointClass === "gstr1-pdf-portal-rendered-download" ||
      endpointClass === "gstr1-pdf-portal-blob-captured-download"
    );
  }
  if (returnType === "GSTR-1" && artifactType === "EXCEL") {
    return (
      endpointClass === "gstr1-excel-portal-rendered-download" ||
      endpointClass === "gstr1-excel-portal-blob-captured-download"
    );
  }
  return (
    returnType === "GSTR-2B" &&
    (artifactType === "PDF" || artifactType === "EXCEL") &&
    (endpointClass === "filed-return-portal-rendered-download" ||
      endpointClass === "gstr2b-portal-blob-captured-download")
  );
}

export function isFiledReturnsEndpointPathPair(
  endpointClass: FiledReturnsDownloadEndpointClass,
  downloadPathClass: FiledReturnsDownloadPathClass,
): boolean {
  if (endpointClass === "unknown") return true;
  if (downloadPathClass === "target-bound-portal-click-blob") {
    return endpointClass === "gstr3b-portal-rendered-download";
  }
  if (downloadPathClass.startsWith("extension-direct-")) {
    return endpointClass === "gstr3b-browser-managed-direct-download";
  }
  return endpointClass.includes("portal-blob-captured-download")
    ? downloadPathClass.startsWith("captured-portal-request-")
    : endpointClass.includes("portal-rendered-download") &&
        downloadPathClass.startsWith("portal-click-");
}

export function isPortalClickDownloadPath(
  downloadPathClass: FiledReturnsDownloadPathClass,
): boolean {
  return downloadPathClass.startsWith("portal-click-");
}

export function isTargetBoundPortalClickDownloadPath(
  downloadPathClass: FiledReturnsDownloadPathClass,
): boolean {
  return downloadPathClass === "target-bound-portal-click-blob";
}

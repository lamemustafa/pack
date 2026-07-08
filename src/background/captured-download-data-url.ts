import {
  filedReturnsArtifactMimeTypes,
  type FiledReturnsArtifactExtension,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";
import type { FiledReturnsDownloadTarget } from "../core/contracts";
import {
  isLikelyGstr2bPortalXlsxBytes,
  isLikelyPdfBytes,
  isLikelyXlsBytes,
  isLikelyXlsxBytes,
} from "../core/filed-return-artifact-bytes";
import type { FiledReturnsReturnType } from "../core/filed-returns-return-types";
import { PACK_OFFSCREEN_DATA_URL_MAX_LENGTH } from "../core/offscreen-blob-url";

const GSTR2B_MIN_PORTAL_PDF_BYTES = 20 * 1024;

export function isExpectedCapturedDataUrl(
  dataUrl: string,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  if (dataUrl.length > PACK_OFFSCREEN_DATA_URL_MAX_LENGTH) return false;
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return false;
  const metadata = decoded.metadata.toLowerCase();
  if (metadata.length === 0) return false;
  if (artifactType === "PDF") {
    return (
      isLikelyPdfBytes(decoded.bytes) &&
      (metadataIncludesExpectedMime(metadata, artifactType) ||
        metadata.includes("application/octet-stream"))
    );
  }

  return (
    metadataIncludesExpectedMime(metadata, artifactType) &&
    (isLikelyXlsxBytes(decoded.bytes) || isLikelyXlsBytes(decoded.bytes))
  );
}

export function isExpectedCapturedDataUrlForTarget(
  dataUrl: string,
  artifactType: FiledReturnsConcreteArtifactType,
  target: FiledReturnsDownloadTarget,
): boolean {
  return isExpectedCapturedDataUrlForReturnType(dataUrl, artifactType, target.returnType);
}

export function isExpectedCapturedDataUrlForReturnType(
  dataUrl: string,
  artifactType: FiledReturnsConcreteArtifactType,
  returnType: FiledReturnsReturnType,
): boolean {
  if (!isExpectedCapturedDataUrl(dataUrl, artifactType)) return false;
  if (returnType !== "GSTR-2B") return true;
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return false;
  if (artifactType === "PDF") {
    return decoded.bytes.byteLength >= GSTR2B_MIN_PORTAL_PDF_BYTES;
  }
  return isLikelyGstr2bPortalXlsxBytes(decoded.bytes);
}

export function capturedFiledReturnsArtifactExtension(
  dataUrl: string,
  artifactType: FiledReturnsConcreteArtifactType,
): FiledReturnsArtifactExtension {
  if (artifactType === "PDF") return ".pdf";
  const decoded = decodeDataUrl(dataUrl);
  return decoded && isLikelyXlsBytes(decoded.bytes) ? ".xls" : ".xlsx";
}

function metadataIncludesExpectedMime(
  metadata: string,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  return filedReturnsArtifactMimeTypes(artifactType).some((mimeType) =>
    metadata.includes(mimeType),
  );
}

function decodeDataUrl(dataUrl: string): { metadata: string; bytes: Uint8Array } | null {
  if (!dataUrl.startsWith("data:")) return null;
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex <= 0) return null;
  const metadata = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  if (metadata.toLowerCase().includes(";base64")) {
    try {
      return { metadata, bytes: binaryStringToBytes(globalThis.atob(payload)) };
    } catch {
      return null;
    }
  }
  try {
    return { metadata, bytes: binaryStringToBytes(decodeURIComponent(payload)) };
  } catch {
    return null;
  }
}

function binaryStringToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

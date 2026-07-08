import {
  filedReturnsArtifactMimeTypes,
  type FiledReturnsArtifactExtension,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";
import type { FiledReturnsDownloadTarget } from "../core/contracts";
import type { FiledReturnsReturnType } from "../core/filed-returns-return-types";
import { PACK_OFFSCREEN_DATA_URL_MAX_LENGTH } from "../core/offscreen-blob-url";

const GSTR2B_MIN_PORTAL_PDF_BYTES = 20 * 1024;

export function isExpectedCapturedDataUrl(
  dataUrl: string,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  if (!dataUrl.startsWith("data:")) return false;
  if (dataUrl.length > PACK_OFFSCREEN_DATA_URL_MAX_LENGTH) return false;
  const metadataEnd = dataUrl.indexOf(",");
  if (metadataEnd <= 0) return false;
  const metadata = dataUrl.slice(0, Math.min(metadataEnd, 200)).toLowerCase();
  if (metadata.length === 0) return false;
  if (artifactType === "PDF") {
    return (
      hasPdfMagicBytes(dataUrl) &&
      (metadataIncludesExpectedMime(metadata, artifactType) ||
        metadata.includes("application/octet-stream"))
    );
  }

  return (
    metadataIncludesExpectedMime(metadata, artifactType) &&
    (hasZipMagicBytes(dataUrl) || hasOleCompoundFileMagicBytes(dataUrl))
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
  if (artifactType === "PDF") {
    return decodedDataUrlByteLength(dataUrl) >= GSTR2B_MIN_PORTAL_PDF_BYTES;
  }
  return isSaneSpreadsheetZipDataUrl(dataUrl);
}

export function capturedFiledReturnsArtifactExtension(
  dataUrl: string,
  artifactType: FiledReturnsConcreteArtifactType,
): FiledReturnsArtifactExtension {
  if (artifactType === "PDF") return ".pdf";
  return hasOleCompoundFileMagicBytes(dataUrl) ? ".xls" : ".xlsx";
}

function metadataIncludesExpectedMime(
  metadata: string,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  return filedReturnsArtifactMimeTypes(artifactType).some((mimeType) =>
    metadata.includes(mimeType),
  );
}

function hasPdfMagicBytes(dataUrl: string): boolean {
  return decodeDataUrlPrefix(dataUrl, 8)?.startsWith("%PDF-") ?? false;
}

function hasZipMagicBytes(dataUrl: string): boolean {
  return decodeDataUrlPrefix(dataUrl, 4)?.startsWith("PK\u0003\u0004") ?? false;
}

function hasOleCompoundFileMagicBytes(dataUrl: string): boolean {
  return decodeDataUrlPrefix(dataUrl, 8)?.startsWith("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") ?? false;
}

function decodeDataUrlPrefix(dataUrl: string, byteCount: number): string | null {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex <= 0) return null;
  const metadata = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (metadata.includes(";base64")) {
    try {
      return globalThis.atob(payload.slice(0, Math.ceil((byteCount * 4) / 3) + 4));
    } catch {
      return null;
    }
  }
  try {
    return decodeURIComponent(payload.slice(0, byteCount * 3));
  } catch {
    return null;
  }
}

function decodedDataUrlByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex <= 0) return 0;
  const metadata = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (!metadata.includes(";base64")) return decodeDataUrlText(dataUrl)?.length ?? 0;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function isSaneSpreadsheetZipDataUrl(dataUrl: string): boolean {
  const text = decodeDataUrlText(dataUrl);
  if (!text) return false;
  if (!text.includes("[Content_Types].xml") || !text.includes("xl/workbook.xml")) return false;
  return hasSupportedFirstZipLocalHeader(text);
}

function hasSupportedFirstZipLocalHeader(text: string): boolean {
  if (!text.startsWith("PK\u0003\u0004") || text.length < 30) return false;
  const generalPurposeFlags = readLittleEndianUint16(text, 6);
  const compressionMethod = readLittleEndianUint16(text, 8);
  if (generalPurposeFlags === null || compressionMethod === null) return false;
  const unsupportedFlagsMask = 0x0001 | 0x0004 | 0x0008 | 0x0040 | 0x2000;
  return (generalPurposeFlags & unsupportedFlagsMask) === 0 && [0, 8].includes(compressionMethod);
}

function readLittleEndianUint16(text: string, offset: number): number | null {
  if (text.length < offset + 2) return null;
  return text.charCodeAt(offset) | (text.charCodeAt(offset + 1) << 8);
}

function decodeDataUrlText(dataUrl: string): string | null {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex <= 0) return null;
  const metadata = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  try {
    return metadata.includes(";base64") ? globalThis.atob(payload) : decodeURIComponent(payload);
  } catch {
    return null;
  }
}

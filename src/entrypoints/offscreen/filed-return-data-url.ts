import {
  filedReturnsArtifactMimeTypes,
  type FiledReturnsConcreteArtifactType,
} from "../../core/filed-returns-artifacts";
import type { FiledReturnsReturnType } from "../../core/filed-returns-return-types";

const GSTR2B_MIN_PORTAL_PDF_BYTES = 20 * 1024;

export function dataUrlToBlob(dataUrl: string): Blob | null {
  return dataUrlToDecoded(dataUrl)?.blob ?? null;
}

export function dataUrlChunksToDecoded(
  chunks: readonly string[],
): { blob: Blob; bytes: Uint8Array; metadata: string } | null {
  const parsed = splitDataUrlChunks(chunks);
  if (!parsed) return null;

  const { metadata, payloadChunks } = parsed;
  const mimeType = metadata.split(";")[0] || "application/octet-stream";
  try {
    const bytes = metadata.toLowerCase().includes(";base64")
      ? decodeBase64Chunks(payloadChunks)
      : decodeTextChunks(payloadChunks);
    if (!bytes || bytes.byteLength === 0) return null;
    return {
      blob: new Blob([toArrayBuffer(bytes)], { type: mimeType }),
      bytes,
      metadata,
    };
  } catch {
    return null;
  }
}

export function isExpectedDecodedDataUrlForReturnType(
  metadata: string,
  bytes: Uint8Array,
  artifactType: FiledReturnsConcreteArtifactType,
  returnType: FiledReturnsReturnType,
): boolean {
  if (!isExpectedDecodedDataUrl(metadata, bytes, artifactType)) return false;
  if (returnType !== "GSTR-2B") return true;
  if (artifactType === "PDF") {
    return bytes.byteLength >= GSTR2B_MIN_PORTAL_PDF_BYTES;
  }
  return isSaneSpreadsheetZipBytes(bytes);
}

function dataUrlToDecoded(
  dataUrl: string,
): { blob: Blob; bytes: Uint8Array; metadata: string } | null {
  return dataUrlChunksToDecoded([dataUrl]);
}

function splitDataUrlChunks(
  chunks: readonly string[],
): { metadata: string; payloadChunks: string[] } | null {
  if (chunks.length === 0) return null;

  let prefix = "";
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] ?? "";
    const commaIndex = chunk.indexOf(",");
    if (commaIndex < 0) {
      prefix += chunk;
      if (prefix.length > 512) return null;
      continue;
    }

    const header = `${prefix}${chunk.slice(0, commaIndex)}`;
    if (!header.startsWith("data:") || header.length <= 5) return null;
    return {
      metadata: header.slice(5),
      payloadChunks: [chunk.slice(commaIndex + 1), ...chunks.slice(index + 1)],
    };
  }

  return null;
}

function decodeBase64Chunks(chunks: readonly string[]): Uint8Array | null {
  const byteChunks: Uint8Array[] = [];
  let pending = "";

  for (let index = 0; index < chunks.length; index += 1) {
    pending += chunks[index] ?? "";
    const isLastChunk = index === chunks.length - 1;
    const decodeLength = isLastChunk ? pending.length : pending.length - (pending.length % 4);
    if (decodeLength <= 0) continue;
    const decoded = atob(pending.slice(0, decodeLength));
    const bytes = new Uint8Array(decoded.length);
    for (let byteIndex = 0; byteIndex < decoded.length; byteIndex += 1) {
      bytes[byteIndex] = decoded.charCodeAt(byteIndex);
    }
    byteChunks.push(bytes);
    pending = pending.slice(decodeLength);
  }

  if (pending.length > 0) return null;
  return concatenateBytes(byteChunks);
}

function decodeTextChunks(chunks: readonly string[]): Uint8Array | null {
  const text = decodeURIComponent(chunks.join(""));
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index);
  }
  return bytes;
}

function concatenateBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function isExpectedDecodedDataUrl(
  metadata: string,
  bytes: Uint8Array,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  const normalizedMetadata = metadata.toLowerCase();
  if (artifactType === "PDF") {
    return (
      bytesStartWithAscii(bytes, "%PDF-") &&
      (metadataIncludesExpectedMime(normalizedMetadata, artifactType) ||
        normalizedMetadata.includes("application/octet-stream"))
    );
  }

  return (
    metadataIncludesExpectedMime(normalizedMetadata, artifactType) &&
    (bytesStartWithAscii(bytes, "PK\u0003\u0004") || bytesStartWith(bytes, OLE_COMPOUND_FILE_MAGIC))
  );
}

function metadataIncludesExpectedMime(
  metadata: string,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  return filedReturnsArtifactMimeTypes(artifactType).some((mimeType) =>
    metadata.includes(mimeType),
  );
}

function isSaneSpreadsheetZipBytes(bytes: Uint8Array): boolean {
  return (
    bytesIncludeAscii(bytes, "[Content_Types].xml") &&
    bytesIncludeAscii(bytes, "xl/workbook.xml") &&
    hasSupportedFirstZipLocalHeader(bytes)
  );
}

function hasSupportedFirstZipLocalHeader(bytes: Uint8Array): boolean {
  if (!bytesStartWithAscii(bytes, "PK\u0003\u0004") || bytes.byteLength < 30) return false;
  const generalPurposeFlags = readLittleEndianUint16(bytes, 6);
  const compressionMethod = readLittleEndianUint16(bytes, 8);
  if (generalPurposeFlags === null || compressionMethod === null) return false;
  const unsupportedFlagsMask = 0x0001 | 0x0004 | 0x0008 | 0x0040 | 0x2000;
  return (generalPurposeFlags & unsupportedFlagsMask) === 0 && [0, 8].includes(compressionMethod);
}

function readLittleEndianUint16(bytes: Uint8Array, offset: number): number | null {
  if (bytes.byteLength < offset + 2) return null;
  const low = bytes[offset];
  const high = bytes[offset + 1];
  if (low === undefined || high === undefined) return null;
  return low | (high << 8);
}

function bytesStartWithAscii(bytes: Uint8Array, marker: string): boolean {
  if (bytes.byteLength < marker.length) return false;
  for (let index = 0; index < marker.length; index += 1) {
    if ((bytes[index] ?? -1) !== marker.charCodeAt(index)) return false;
  }
  return true;
}

function bytesStartWith(bytes: Uint8Array, marker: readonly number[]): boolean {
  if (bytes.byteLength < marker.length) return false;
  return marker.every((byte, index) => bytes[index] === byte);
}

function bytesIncludeAscii(bytes: Uint8Array, marker: string): boolean {
  if (marker.length === 0 || bytes.byteLength < marker.length) return false;
  const first = marker.charCodeAt(0);
  const loweredFirst = lowerAscii(first);
  for (let index = 0; index <= bytes.byteLength - marker.length; index += 1) {
    if (lowerAscii(bytes[index] ?? -1) !== loweredFirst) continue;
    let matched = true;
    for (let markerIndex = 1; markerIndex < marker.length; markerIndex += 1) {
      if (
        lowerAscii(bytes[index + markerIndex] ?? -1) !==
        lowerAscii(marker.charCodeAt(markerIndex))
      ) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function lowerAscii(byte: number): number {
  return byte >= 65 && byte <= 90 ? byte + 32 : byte;
}

const OLE_COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

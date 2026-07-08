import {
  filedReturnsArtifactMimeTypes,
  type FiledReturnsConcreteArtifactType,
} from "../../core/filed-returns-artifacts";
import {
  isLikelyGstr2bPortalXlsxBytes,
  isLikelyPdfBytes,
  isLikelyXlsBytes,
  isLikelyXlsxBytes,
} from "../../core/filed-return-artifact-bytes";
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
  return isExpectedFiledReturnBytesForReturnType(bytes, artifactType, returnType);
}

export function isExpectedFiledReturnBytesForReturnType(
  bytes: Uint8Array,
  artifactType: FiledReturnsConcreteArtifactType,
  returnType: FiledReturnsReturnType,
): boolean {
  if (!isExpectedFiledReturnBytes(bytes, artifactType)) return false;
  if (returnType !== "GSTR-2B") return true;
  if (artifactType === "PDF") {
    return bytes.byteLength >= GSTR2B_MIN_PORTAL_PDF_BYTES;
  }
  return isLikelyGstr2bPortalXlsxBytes(bytes);
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
      isExpectedFiledReturnBytes(bytes, artifactType) &&
      (metadataIncludesExpectedMime(normalizedMetadata, artifactType) ||
        normalizedMetadata.includes("application/octet-stream"))
    );
  }

  return (
    metadataIncludesExpectedMime(normalizedMetadata, artifactType) &&
    isExpectedFiledReturnBytes(bytes, artifactType)
  );
}

function isExpectedFiledReturnBytes(
  bytes: Uint8Array,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  return artifactType === "PDF"
    ? isLikelyPdfBytes(bytes)
    : isLikelyXlsxBytes(bytes) || isLikelyXlsBytes(bytes);
}

function metadataIncludesExpectedMime(
  metadata: string,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  return filedReturnsArtifactMimeTypes(artifactType).some((mimeType) =>
    metadata.includes(mimeType),
  );
}

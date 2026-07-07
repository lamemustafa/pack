import {
  filedReturnsArtifactMimeTypes,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";
import { PACK_OFFSCREEN_DATA_URL_MAX_LENGTH } from "../core/offscreen-blob-url";

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

  return metadataIncludesExpectedMime(metadata, artifactType) && hasZipMagicBytes(dataUrl);
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

const PDF_EOF_SCAN_BYTES = 4096;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_EOCD_SCAN_BYTES = 65_557;
const OLE_COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

export const GSTR2B_PORTAL_WORKBOOK_ENTRIES = [
  "[content_types].xml",
  "xl/workbook.xml",
  "xl/worksheets/sheet10.xml",
] as const;

export function isLikelyPdfBytes(bytes: Uint8Array): boolean {
  if (!bytesStartWithAscii(bytes, "%PDF-")) return false;
  const suffixStart = Math.max(0, bytes.byteLength - PDF_EOF_SCAN_BYTES);
  return bytesToLatin1(bytes.slice(suffixStart)).includes("%%EOF");
}

export function isLikelyXlsBytes(bytes: Uint8Array): boolean {
  return bytesStartWith(bytes, OLE_COMPOUND_FILE_MAGIC);
}

export function isLikelyXlsxBytes(
  bytes: Uint8Array,
  requiredEntries: readonly string[] = ["[content_types].xml", "xl/workbook.xml"],
): boolean {
  if (!bytesStartWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false;
  const entries = readZipEntryNames(bytes);
  if (!entries) return false;
  const names = new Set(entries.map((entry) => entry.toLowerCase()));
  return requiredEntries.every((entry) => names.has(entry.toLowerCase()));
}

function readZipEntryNames(bytes: Uint8Array): string[] | null {
  try {
    const view = dataView(bytes);
    const eocdOffset = findEndOfCentralDirectory(view);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
    const names: string[] = [];
    let offset = centralDirectoryOffset;

    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > bytes.byteLength) return null;
      if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_HEADER) return null;
      const flags = view.getUint16(offset + 8, true);
      const compressionMethod = view.getUint16(offset + 10, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLength;
      if (nameEnd > bytes.byteLength) return null;
      if (!isSupportedZipEntry(view, localHeaderOffset, flags, compressionMethod)) return null;
      names.push(new TextDecoder().decode(bytes.slice(nameStart, nameEnd)));
      offset = nameEnd + extraLength + commentLength;
    }

    return names;
  } catch {
    return null;
  }
}

function isSupportedZipEntry(
  view: DataView,
  localHeaderOffset: number,
  flags: number,
  compressionMethod: number,
): boolean {
  if (localHeaderOffset + 30 > view.byteLength) return false;
  if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER) return false;
  const unsupportedFlagsMask = 0x0001 | 0x0040 | 0x2000;
  return (flags & unsupportedFlagsMask) === 0 && [0, 8].includes(compressionMethod);
}

function findEndOfCentralDirectory(view: DataView): number {
  const scanStart = Math.max(0, view.byteLength - MAX_EOCD_SCAN_BYTES);
  for (let offset = view.byteLength - 22; offset >= scanStart; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("ZIP end of central directory not found.");
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

function bytesToLatin1(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    text += String.fromCharCode(...bytes.slice(offset, offset + 32_768));
  }
  return text;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

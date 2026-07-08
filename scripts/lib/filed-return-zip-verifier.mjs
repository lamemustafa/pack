import { TextDecoder } from "node:util";

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_EOCD_SCAN_BYTES = 65_557;

export function verifyFiledReturnZipBytes(bytes) {
  const outerEntries = readZipEntries(bytes);
  const result = {
    ok: false,
    entries: outerEntries.length,
    pdf: 0,
    xls: 0,
    xlsx: 0,
    unknown: 0,
    failures: [],
  };

  const seenNames = new Set();
  for (const entry of outerEntries) {
    const nameClass = classifyEntryName(entry.name);
    if (!nameClass.safe) {
      result.failures.push(`unsafe-entry-path:${nameClass.reason}`);
      continue;
    }
    if (seenNames.has(entry.name)) {
      result.failures.push("duplicate-entry-path");
      continue;
    }
    seenNames.add(entry.name);

    if (entry.compressionMethod !== 0) {
      result.failures.push("outer-entry-compressed");
      continue;
    }
    if (!isValidDosDate(entry.modifiedDate)) {
      result.failures.push("invalid-entry-timestamp");
      continue;
    }

    const entryBytes = readStoredEntryBytes(bytes, entry);
    const extension = extensionOf(entry.name);
    if (extension === ".pdf") {
      result.pdf += 1;
      if (!isLikelyPdf(entryBytes)) result.failures.push("invalid-pdf");
      continue;
    }
    if (extension === ".xlsx") {
      result.xlsx += 1;
      if (!isLikelyXlsx(entryBytes)) result.failures.push("invalid-xlsx");
      continue;
    }
    if (extension === ".xls") {
      result.xls += 1;
      if (!isLikelyXls(entryBytes)) result.failures.push("invalid-xls");
      continue;
    }

    result.unknown += 1;
    result.failures.push("unknown-entry-type");
  }

  result.ok =
    result.entries > 0 &&
    result.unknown === 0 &&
    result.failures.length === 0 &&
    result.pdf + result.xls + result.xlsx === result.entries;
  return result;
}

export function sanitizeVerificationResult(result) {
  return {
    ok: result.ok,
    entries: result.entries,
    pdf: result.pdf,
    xls: result.xls,
    xlsx: result.xlsx,
    unknown: result.unknown,
    failures: [...new Set(result.failures)].sort(),
  };
}

function readZipEntries(bytes) {
  const view = dataView(bytes);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength) throw new Error("Central directory is truncated.");
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error("Central directory header is invalid.");
    }
    const compressionMethod = view.getUint16(offset + 10, true);
    const modifiedDate = view.getUint16(offset + 14, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) throw new Error("Central directory name is truncated.");

    entries.push({
      compressedSize,
      compressionMethod,
      localHeaderOffset,
      modifiedDate,
      name: new TextDecoder().decode(bytes.slice(nameStart, nameEnd)),
      uncompressedSize,
    });
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function readStoredEntryBytes(zipBytes, entry) {
  if (entry.compressedSize !== entry.uncompressedSize) {
    throw new Error("Stored ZIP entry size mismatch.");
  }
  const view = dataView(zipBytes);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > zipBytes.byteLength || view.getUint32(offset, true) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error("Local file header is invalid.");
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > zipBytes.byteLength) throw new Error("Stored ZIP entry is truncated.");
  return zipBytes.slice(dataStart, dataEnd);
}

function findEndOfCentralDirectory(view) {
  const scanStart = Math.max(0, view.byteLength - MAX_EOCD_SCAN_BYTES);
  for (let offset = view.byteLength - 22; offset >= scanStart; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("ZIP end of central directory not found.");
}

function classifyEntryName(name) {
  if (!name) return { safe: false, reason: "empty" };
  if (name.startsWith("/") || /^[a-z]:/i.test(name)) return { safe: false, reason: "absolute" };
  if (name.includes("\\") || name.includes(":")) return { safe: false, reason: "separator" };
  const parts = name.split("/");
  if (parts.length !== 1) return { safe: false, reason: "nested" };
  if (parts.some((part) => part === "." || part === "..")) {
    return { safe: false, reason: "traversal" };
  }
  return { safe: true };
}

function extensionOf(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return ".pdf";
  if (lower.endsWith(".xlsx")) return ".xlsx";
  if (lower.endsWith(".xls")) return ".xls";
  return "";
}

function isLikelyPdf(bytes) {
  if (bytes.byteLength < 8) return false;
  const prefix = new TextDecoder().decode(bytes.slice(0, 8));
  if (!prefix.startsWith("%PDF-")) return false;
  const suffixStart = Math.max(0, bytes.byteLength - 4096);
  const suffix = new TextDecoder().decode(bytes.slice(suffixStart));
  return suffix.includes("%%EOF");
}

function isLikelyXlsx(bytes) {
  if (bytes.byteLength < 22) return false;
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false;
  try {
    const names = new Set(readZipEntries(bytes).map((entry) => entry.name));
    return names.has("[Content_Types].xml") && names.has("xl/workbook.xml");
  } catch {
    return false;
  }
}

function isLikelyXls(bytes) {
  return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function isValidDosDate(value) {
  const day = value & 0x1f;
  const month = (value >> 5) & 0x0f;
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

function startsWith(bytes, prefix) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

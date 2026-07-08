import { describe, expect, it } from "vitest";
import { createZip } from "../../src/entrypoints/offscreen/zip";

describe("offscreen ZIP writer", () => {
  it("creates a readable stored ZIP without mutating PDF or workbook bytes", () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.7\nsynthetic gstr2b pdf");
    const workbookBytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x77, 0x6f,
      0x72, 0x6b, 0x62, 0x6f, 0x6f, 0x6b,
    ]);

    const zipBytes = createZip([
      { path: "may.pdf", bytes: pdfBytes },
      { path: "may.xlsx", bytes: workbookBytes },
    ]);

    const entries = extractStoredZipEntries(zipBytes);

    expect([...entries.keys()]).toEqual(["may.pdf", "may.xlsx"]);
    expect(entries.get("may.pdf")).toEqual(pdfBytes);
    expect(entries.get("may.xlsx")).toEqual(workbookBytes);
    expect(findEndOfCentralDirectory(zipBytes).entryCount).toBe(2);
  });

  it("preserves simple entry paths without embedding the browser download path", () => {
    const zipBytes = createZip([
      { path: "april.pdf", bytes: new TextEncoder().encode("%PDF april") },
      { path: "april.xlsx", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) },
    ]);

    const entries = extractStoredZipEntries(zipBytes);

    expect([...entries.keys()]).toEqual(["april.pdf", "april.xlsx"]);
    expect([...entries.keys()].some((path) => path.includes("/"))).toBe(false);
  });
});

function extractStoredZipEntries(zipBytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let offset = 0;

  while (offset + 30 <= zipBytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    expect(compressionMethod).toBe(0);
    expect(compressedSize).toBe(uncompressedSize);
    expect(dataEnd).toBeLessThanOrEqual(zipBytes.byteLength);

    const name = decoder.decode(zipBytes.slice(nameStart, nameStart + nameLength));
    entries.set(name, zipBytes.slice(dataStart, dataEnd));
    offset = dataEnd;
  }

  return entries;
}

function findEndOfCentralDirectory(zipBytes: Uint8Array): { entryCount: number } {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  for (let offset = zipBytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    return { entryCount: view.getUint16(offset + 10, true) };
  }
  throw new Error("Missing ZIP end of central directory.");
}

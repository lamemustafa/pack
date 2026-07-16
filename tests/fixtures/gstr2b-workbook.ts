import { createZip } from "../../src/entrypoints/offscreen/zip";

export function createPortalGstr2bWorkbook(marker = ""): Uint8Array {
  return createZip([
    { path: "[Content_Types].xml", bytes: textBytes("<Types />") },
    { path: "xl/_rels/workbook.xml.rels", bytes: textBytes("<Relationships />") },
    { path: "xl/sharedStrings.xml", bytes: textBytes("<sst />") },
    { path: "xl/styles.xml", bytes: textBytes("<styleSheet />") },
    { path: "xl/workbook.xml", bytes: textBytes(`<workbook>${marker}</workbook>`) },
    ...Array.from({ length: 10 }, (_, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      bytes: textBytes("<worksheet />"),
    })),
  ]);
}

export function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

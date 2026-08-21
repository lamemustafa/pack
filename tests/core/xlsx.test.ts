import { describe, expect, it } from "vitest";
import { createXlsx, XlsxSizeLimitError } from "../../src/core/xlsx";

describe("portal-neutral XLSX writer", () => {
  it("writes deterministic named worksheets with numeric, date, style and pane metadata", () => {
    const input = {
      generatedAt: new Date("2026-08-19T12:00:00.000Z"),
      worksheets: [
        {
          name: "Statement",
          freezeFirstColumnAndRows: 5,
          columns: [{ width: 42 }, { width: 14 }],
          rows: [
            [
              { value: "Description", style: "bold" as const },
              { value: 46_022, style: "bold-date" as const },
            ],
            [{ value: "Synthetic amount" }, { value: 12.5, style: "number" as const }],
          ],
        },
        { name: "Context", rows: [[{ value: "Synthetic context" }]] },
      ],
    };

    const first = createXlsx(input);
    const second = createXlsx(input);
    expect(second).toEqual(first);

    const entries = extractStoredZipEntries(first);
    expect([...entries.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(text(entries, "xl/workbook.xml")).toContain('<sheet name="Statement"');
    expect(text(entries, "xl/workbook.xml")).toContain('<sheet name="Context"');
    const statement = text(entries, "xl/worksheets/sheet1.xml");
    expect(statement).toContain('pane xSplit="1" ySplit="5" topLeftCell="B6"');
    expect(statement).toContain('<col min="1" max="1" width="42" customWidth="1"/>');
    expect(statement).toContain('<c r="B2" s="2"><v>12.5</v></c>');
    expect(statement).not.toContain("<f>");
  });

  it("writes ZIP entry timestamps with the local clock components", () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "Asia/Kolkata";
    try {
      const generatedAt = new Date("2026-08-20T19:00:00.000Z");
      const bytes = createXlsx({
        generatedAt,
        worksheets: [{ name: "Statement", rows: [[{ value: "Synthetic value" }]] }],
      });
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      expect(view.getUint16(10, true)).toBe(
        (generatedAt.getHours() << 11) |
          (generatedAt.getMinutes() << 5) |
          Math.floor(generatedAt.getSeconds() / 2),
      );
      expect(view.getUint16(12, true)).toBe(
        ((generatedAt.getFullYear() - 1980) << 9) |
          ((generatedAt.getMonth() + 1) << 5) |
          generatedAt.getDate(),
      );
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });

  it("fails closed for invalid names, non-finite numbers and bounded output", () => {
    const base = { generatedAt: new Date("2026-08-19T12:00:00.000Z") };
    expect(() => createXlsx({ ...base, worksheets: [{ name: "Bad/Name", rows: [[]] }] })).toThrow(
      "worksheet name",
    );
    expect(() =>
      createXlsx({
        ...base,
        worksheets: [{ name: "Numbers", rows: [[{ value: Number.NaN }]] }],
      }),
    ).toThrow("finite");
    expect(() =>
      createXlsx({ ...base, worksheets: [{ name: "Bounded", rows: [[{ value: "x" }]] }] }, 32),
    ).toThrow(XlsxSizeLimitError);
    expect(() =>
      createXlsx({
        ...base,
        worksheets: [{ name: "Frozen", freezeFirstColumnAndRows: 0, rows: [[]] }],
      }),
    ).toThrow("frozen row count");
    expect(() =>
      createXlsx({
        ...base,
        worksheets: [{ name: "Strings", rows: [[{ value: "invalid\u0000xml" }]] }],
      }),
    ).toThrow("Invalid XLSX string cell");
    expect(() =>
      createXlsx({
        ...base,
        worksheets: [{ name: "Strings", rows: [[{ value: "invalid\ud800xml" }]] }],
      }),
    ).toThrow("Invalid XLSX string cell");
  });
});

function extractStoredZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    entries.set(name, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

function text(entries: Map<string, Uint8Array>, path: string): string {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`Missing synthetic workbook part ${path}`);
  return new TextDecoder().decode(bytes);
}

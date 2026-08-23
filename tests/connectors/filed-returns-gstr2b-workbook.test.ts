import { describe, expect, it } from "vitest";
import { XlsxSizeLimitError } from "../../src/core/xlsx";
import {
  buildFiledReturnsGstr2bWorkbook,
  FiledReturnsGstr2bWorkbookPrivacyError,
  FiledReturnsGstr2bWorkbookSchemaError,
} from "../../src/connectors/gst/filed-returns-gstr2b-workbook";
import type { FiledReturnsSummaryPlanEntry } from "../../src/connectors/gst/filed-returns-summary-sheet";

const OWNER_GSTIN = "27ABCDE1234F1Z0";
const COUNTERPARTY_GSTIN = "27ABCDE1000F1ZC";

describe("GSTR-2B consolidated workbook", () => {
  it("writes one invoice row per nested record with static present-section sheets", () => {
    const workbook = buildWorkbook(docdata());
    const entries = extractStoredZipEntries(workbook);

    expect(sheetNames(text(entries, "xl/workbook.xml"))).toEqual(["B2B", "B2BA", "CDNR", "IMPG"]);
    expect(text(entries, "xl/workbook.xml")).not.toContain(COUNTERPARTY_GSTIN);

    const b2b = text(entries, "xl/worksheets/sheet1.xml");
    expect(b2b.match(new RegExp(COUNTERPARTY_GSTIN, "g"))).toHaveLength(2);
    expect(b2b.match(/Synthetic Counterparty Private Limited/g)).toHaveLength(2);
    expect(b2b).toContain("INV-001");
    expect(b2b).toContain("INV-002");
    expect(b2b).toContain('<c r="H7" s="2"><v>110</v></c>');
    expect(b2b).toContain('pane xSplit="1" ySplit="6" topLeftCell="B7"');
    expect(b2b).toContain("B2B invoice-level records present in the captured JSON.");
    expect(b2b).not.toContain("/data/");
    expect(b2b.match(new RegExp(OWNER_GSTIN, "g"))).toHaveLength(1);
    expect(b2b.match(/Synthetic Owner Legal Name/g)).toHaveLength(1);
    expect(b2b.match(/Synthetic Owner Trade Name/g)).toHaveLength(1);

    for (const sheet of ["sheet2.xml", "sheet3.xml", "sheet4.xml"]) {
      const xml = text(entries, `xl/worksheets/${sheet}`);
      expect(xml.match(new RegExp(OWNER_GSTIN, "g"))).toHaveLength(1);
      expect(xml.match(/Synthetic Owner Legal Name/g)).toHaveLength(1);
      expect(xml.match(/Synthetic Owner Trade Name/g)).toHaveLength(1);
    }
  });

  // The existing coverage counts how often an owner value appears in a sheet.
  // A count cannot say WHERE: a defect that dropped the owner from the header
  // and leaked it into one invoice row would still total one, and pass. These
  // partition each sheet and assert placement instead.
  //
  // Both directions are load-bearing. Owner identity in a data row is a privacy
  // defect; counterparty identity MISSING from data rows is the over-redaction
  // defect tracked in #195, which would silently destroy the supplier detail
  // that makes the workbook worth building.
  it("keeps the return owner out of every invoice row on every sheet", () => {
    const entries = extractStoredZipEntries(buildWorkbook(docdata()));
    const ownerValues = [OWNER_GSTIN, "Synthetic Owner Legal Name", "Synthetic Owner Trade Name"];

    for (const sheet of ["sheet1.xml", "sheet2.xml", "sheet3.xml", "sheet4.xml"]) {
      const { header, data } = partitionSheet(text(entries, `xl/worksheets/${sheet}`));

      expect(data.length, `${sheet} has no invoice rows to check`).toBeGreaterThan(0);
      for (const value of ownerValues) {
        expect(
          data.filter((row) => row.includes(value)),
          `${sheet} places the return owner value in an invoice row`,
        ).toEqual([]);
        expect(
          header.some((row) => row.includes(value)),
          `${sheet} no longer states the return owner in its header`,
        ).toBe(true);
      }
    }
  });

  // IMPG is excluded on purpose: imports are declared on a bill of entry and
  // carry no counterparty, so requiring one there would assert a field the
  // portal never sends.
  it("keeps counterparty identity in the invoice rows and out of the header", () => {
    const entries = extractStoredZipEntries(buildWorkbook(docdata()));
    const counterpartyValues = [COUNTERPARTY_GSTIN, "Synthetic Counterparty Private Limited"];

    for (const sheet of ["sheet1.xml", "sheet2.xml", "sheet3.xml"]) {
      const { header, data } = partitionSheet(text(entries, `xl/worksheets/${sheet}`));

      for (const value of counterpartyValues) {
        expect(
          data.some((row) => row.includes(value)),
          `${sheet} lost the counterparty value from its invoice rows -- over-redaction`,
        ).toBe(true);
        expect(
          header.filter((row) => row.includes(value)),
          `${sheet} names a counterparty in the owner header`,
        ).toEqual([]);
      }
    }
  });

  it("does not create an empty worksheet for an absent GSTR-2B section", () => {
    const workbook = buildWorkbook({ b2b: docdata().b2b });
    expect(sheetNames(text(extractStoredZipEntries(workbook), "xl/workbook.xml"))).toEqual(["B2B"]);
  });

  // The workbook footer already promised that unconfirmed portal sections are
  // excluded, while the builder rejected the whole run when it met one. That
  // discarded the tidy CSV too, so a taxpayer whose GSTR-2B carries a section
  // this build does not render lost the artifact that does not depend on it.
  it("renders known sections and names an unrendered one instead of refusing", () => {
    const data = { ...docdata(), isd: [{ ctin: "27ABCDE1000F1ZC" }] } as ReturnType<typeof docdata>;
    const entries = extractStoredZipEntries(buildWorkbook(data));

    expect(sheetNames(text(entries, "xl/workbook.xml"))).toEqual(["B2B", "B2BA", "CDNR", "IMPG"]);
    const b2b = text(entries, "xl/worksheets/sheet1.xml");
    expect(b2b).toContain("Sections present in the source but not rendered: isd.");
    expect(b2b).toContain("INV-001");
  });

  // The forbidden-path screen still applies at that level: relaxing the schema
  // allowlist must not relax privacy.
  it("still fails closed when an unrendered section name is credential-shaped", () => {
    const data = { ...docdata(), sessionData: [{}] } as ReturnType<typeof docdata>;
    expect(() => buildWorkbook(data)).toThrow(FiledReturnsGstr2bWorkbookPrivacyError);
  });

  // JSON.parse turns every amount into a double before the builder sees it, so a
  // figure the portal sent exactly arrives already rounded. Refusing keeps the
  // tidy CSV, which is built by the flattener that preserves numeric tokens as
  // exact decimal text -- the taxpayer gets the exact figure in the artifact
  // that can hold it, instead of a changed one here.
  it("refuses a value it cannot write to a spreadsheet unchanged", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: {
          gstin: OWNER_GSTIN,
          lglnm: "Synthetic Owner Legal Name",
          trdnm: "Synthetic Owner Trade Name",
          rtnprd: "042026",
          docdata: docdata(),
        },
      }).replace('"val":110', '"val":99999999999999.999'),
    );

    expect(() =>
      buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
        generatedAt: new Date("2026-08-22T12:00:00.000Z"),
      }),
    ).toThrow(FiledReturnsGstr2bWorkbookSchemaError);
  });

  it("states its own reason rather than reporting invalid JSON", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: { gstin: OWNER_GSTIN, rtnprd: "042026", docdata: docdata() },
      }).replace('"val":110', '"val":99999999999999.999'),
    );

    expect(() =>
      buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
        generatedAt: new Date("2026-08-22T12:00:00.000Z"),
      }),
    ).toThrow(/cannot be written to a spreadsheet without changing it/);
  });

  // Built from a captured live GSTR-2B period, not from an assumed shape. The
  // capture settled three things the fixtures above could not:
  //
  // 1. `inv[]` is FLAT -- txval/igst/cgst/sgst/cess sit on the invoice, and
  //    there is no nested `items` array;
  // 2. `irn`, `irngendate` and `srctyp` are present on well under half the
  //    invoices, so they are optional and every fixture above over-specified
  //    them by always supplying all three;
  // 3. `docdata` has siblings under `/data` -- `cpsumm`, `itcsumm`, `gendt`,
  //    `version` -- plus a root `chksum`, none of which the builder reads.
  it("renders a captured-shape period whose invoices omit the optional keys", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        chksum: "synthetic-digest",
        data: {
          cpsumm: {
            b2b: [
              {
                cess: 0,
                cgst: 0,
                ctin: COUNTERPARTY_GSTIN,
                igst: 10,
                sgst: 0,
                supfildt: "20-05-2026",
                supprd: "042026",
                trdnm: "Synthetic Counterparty Private Limited",
                ttldocs: 2,
                txval: 100,
              },
            ],
          },
          docdata: {
            b2b: [
              {
                ctin: COUNTERPARTY_GSTIN,
                trdnm: "Synthetic Counterparty Private Limited",
                supfildt: "20-05-2026",
                supprd: "042026",
                inv: [
                  // No irn / irngendate / srctyp: the majority case in the capture.
                  {
                    inum: "INV-900",
                    dt: "01-04-2026",
                    val: 110,
                    txval: 100,
                    igst: 10,
                    cgst: 0,
                    sgst: 0,
                    cess: 0,
                    pos: "27",
                    rev: "N",
                    typ: "R",
                    itcavl: "Y",
                    rsn: "",
                    imsStatus: "ACCEPTED",
                  },
                ],
              },
            ],
          },
          gendt: "14-05-2026",
          gstin: OWNER_GSTIN,
          itcsumm: {
            itcavl: { nonrevsup: { b2b: { cess: 0, cgst: 0, igst: 10, sgst: 0, txval: 100 } } },
          },
          rtnprd: "042026",
          version: "1.0",
        },
      }),
    );

    const workbook = buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
      generatedAt: new Date("2026-08-22T12:00:00.000Z"),
    });
    expect(workbook, "a captured-shape period produced no workbook").not.toBeNull();

    const entries = extractStoredZipEntries(workbook!);
    expect(sheetNames(text(entries, "xl/workbook.xml"))).toEqual(["B2B"]);
    const b2b = text(entries, "xl/worksheets/sheet1.xml");
    expect(b2b).toContain("INV-900");
    expect(b2b).toContain(COUNTERPARTY_GSTIN);
    // The unread siblings are not a reason to exclude anything, and must not
    // leak into the sheet.
    expect(b2b).not.toContain("cpsumm");
    expect(b2b).not.toContain("itcsumm");
    expect(b2b).not.toContain("Sections present in the source but not rendered");
  });

  it("fails closed rather than placing the return owner in a counterparty row", () => {
    const data = docdata();
    data.b2b[0]!.ctin = OWNER_GSTIN;
    expect(() => buildWorkbook(data)).toThrow(FiledReturnsGstr2bWorkbookPrivacyError);
  });

  it("rejects a forbidden source key before copying any invoice value", () => {
    const data = docdata();
    (data.b2b[0]!.inv[0] as Record<string, unknown>).session = "synthetic-sensitive";
    expect(() => buildWorkbook(data)).toThrow(FiledReturnsGstr2bWorkbookPrivacyError);
  });

  it("fails with the XLSX size error instead of truncating invoice rows", () => {
    expect(() =>
      buildWorkbook(docdata(), {
        maxOutputBytes: 512,
      }),
    ).toThrow(XlsxSizeLimitError);
  });

  it("refuses an annual workbook when a staged middle period is absent", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [
      planEntry("April", "april-data.json"),
      planEntry("May", "may-data.json"),
    ];
    expect(() =>
      buildFiledReturnsGstr2bWorkbook(plan, [sourceEntry("april-data.json", docdata())], {
        generatedAt: new Date("2026-08-22T12:00:00.000Z"),
      }),
    ).toThrow(FiledReturnsGstr2bWorkbookSchemaError);
  });
});

function buildWorkbook(
  documentSections: Partial<ReturnType<typeof docdata>>,
  options: { maxOutputBytes?: number } = {},
): Uint8Array {
  const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
  const workbook = buildFiledReturnsGstr2bWorkbook(
    plan,
    [sourceEntry("april-data.json", documentSections)],
    { generatedAt: new Date("2026-08-22T12:00:00.000Z"), ...options },
  );
  if (!workbook) throw new Error("Expected synthetic GSTR-2B workbook.");
  return workbook;
}

function planEntry(period: "April" | "May", entryName: string): FiledReturnsSummaryPlanEntry {
  return {
    artifactType: "JSON",
    entryNames: [entryName],
    financialYear: "2026-27",
    outcomeCategory: "staged",
    period,
    returnType: "GSTR-2B",
  };
}

function sourceEntry(path: string, documentSections: Partial<ReturnType<typeof docdata>>) {
  return {
    path,
    bytes: new TextEncoder().encode(
      JSON.stringify({
        data: {
          gstin: OWNER_GSTIN,
          lglnm: "Synthetic Owner Legal Name",
          trdnm: "Synthetic Owner Trade Name",
          rtnprd: "042026",
          docdata: documentSections,
        },
      }),
    ),
  };
}

function docdata() {
  return {
    b2b: [
      {
        ctin: COUNTERPARTY_GSTIN,
        trdnm: "Synthetic Counterparty Private Limited",
        supfildt: "20-05-2026",
        supprd: "042026",
        inv: [invoice("INV-001", "01-04-2026", 110), invoice("INV-002", "02-04-2026", 220)],
      },
    ],
    b2ba: [
      {
        ctin: COUNTERPARTY_GSTIN,
        trdnm: "Synthetic Counterparty Private Limited",
        supfildt: "20-05-2026",
        supprd: "042026",
        inv: [
          { ...invoice("INV-A-001", "03-04-2026", 330), oinum: "INV-OLD-001", oidt: "01-03-2026" },
        ],
      },
    ],
    cdnr: [
      {
        ctin: COUNTERPARTY_GSTIN,
        trdnm: "Synthetic Counterparty Private Limited",
        supfildt: "20-05-2026",
        supprd: "042026",
        nt: [creditNote("CN-001", "04-04-2026", 440)],
      },
    ],
    impg: [
      {
        boenum: "BE-001",
        boedt: "05-04-2026",
        portcode: "INBOM1",
        refdt: "06-04-2026",
        txval: 500,
        igst: 90,
        cgst: 0,
        cess: 0,
        imsStatus: "ACCEPTED",
        isamd: "N",
      },
    ],
  };
}

function invoice(inum: string, dt: string, val: number) {
  return {
    inum,
    dt,
    val,
    txval: val - 10,
    igst: 10,
    cgst: 0,
    sgst: 0,
    cess: 0,
    pos: "27",
    rev: "N",
    typ: "R",
    itcavl: "Y",
    rsn: "",
    srctyp: "GSTR2B",
    irn: "SYNTHETIC-IRN",
    irngendate: "01-04-2026",
    imsStatus: "ACCEPTED",
  };
}

function creditNote(ntnum: string, dt: string, val: number) {
  return {
    ntnum,
    dt,
    val,
    txval: val - 10,
    igst: 10,
    cgst: 0,
    sgst: 0,
    cess: 0,
    pos: "27",
    rev: "N",
    typ: "R",
    itcavl: "Y",
    rsn: "",
    srctyp: "GSTR2B",
    suptyp: "R",
    irn: "SYNTHETIC-IRN",
    irngendate: "04-04-2026",
    imsStatus: "ACCEPTED",
  };
}

/**
 * Splits a sheet into the owner header, the invoice rows, and the footer, as
 * lists of cell values.
 *
 * Cells are parsed rather than pattern-matched on the raw XML, so the assertions
 * compare whole cell values instead of substrings. The column-header row is
 * found by its leading cell, not a fixed index, so adding an owner field shifts
 * the boundary instead of silently reclassifying a data row as a header row.
 * Keying on "Counterparty GSTIN" instead was wrong: IMPG carries a bill of entry
 * and no counterparty, so that boundary is absent on one of the four sheets.
 */
function partitionSheet(xml: string): { header: string[][]; data: string[][] } {
  const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((match) =>
    (match[1] ?? "")
      .split(/<[^>]+>/)
      .map((cell) => cell.trim())
      .filter((cell) => cell !== ""),
  );
  const columnHeader = rows.findIndex((row) => row[0] === "Period");
  expect(columnHeader, "the column-header row is no longer identifiable").toBeGreaterThan(-1);

  const footer = rows.findIndex((row, index) => index > columnHeader && row[0] === "Source");
  return {
    header: rows.slice(0, columnHeader),
    data: rows.slice(columnHeader + 1, footer === -1 ? rows.length : footer),
  };
}

function sheetNames(xml: string): string[] {
  return [...xml.matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1]!);
}

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

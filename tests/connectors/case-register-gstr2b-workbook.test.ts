import { execFile as execFileCallback } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildFiledReturnsGstr2bWorkbook } from "../../src/connectors/gst/filed-returns-gstr2b-workbook";
import type { FiledReturnsSummaryPlanEntry } from "../../src/connectors/gst/filed-returns-summary-sheet";

const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureDirectory = new URL("../fixtures/casepack/", import.meta.url);
const generator = new URL(
  "../../tools/casepack/generate-gstr2b-case-register.mjs",
  import.meta.url,
);
const mainFixtureName = "CASE-REGISTER-2B-01.gstr2b.json";
const wrongGstinFixtureName = "CASE-REGISTER-2B-01.wrong-gstin.gstr2b.json";
const FULL_INVOICE_KEYS = [
  "inum",
  "dt",
  "val",
  "txval",
  "igst",
  "cgst",
  "sgst",
  "cess",
  "pos",
  "rev",
  "typ",
  "itcavl",
  "rsn",
  "srctyp",
  "irn",
  "irngendate",
  "imsStatus",
] as const;

const EXPECTED_TOTALS = {
  b2b: { cgst: 43741.11, igst: 111600, sgst: 43741.11, txval: 1119345.67 },
  b2ba: { cgst: 4050, igst: 0, sgst: 4050, txval: 45000 },
  cdnr: { cgst: -1800, igst: -1800, sgst: -1800, txval: -30000 },
  impg: { cgst: 0, igst: 54000, txval: 300000 },
} as const;

describe("CASE-REGISTER-2B-01 GSTR-2B fixtures", () => {
  it("generates the checked-in main and wrong-registration fixtures deterministically", async () => {
    const generatedDirectory = await mkdtemp(`${tmpdir()}/casepack-gstr2b-`);
    try {
      await execFile(
        process.execPath,
        [fileURLToPath(generator), "case_register.json", generatedDirectory],
        {
          cwd: projectRoot,
        },
      );
      await expect(readGenerated(generatedDirectory, mainFixtureName)).resolves.toBe(
        await readFixture(mainFixtureName),
      );
      await expect(readGenerated(generatedDirectory, wrongGstinFixtureName)).resolves.toBe(
        await readFixture(wrongGstinFixtureName),
      );
    } finally {
      await rm(generatedDirectory, { force: true, recursive: true });
    }
  });

  it("feeds the main fixture to the real workbook builder with literal register totals", async () => {
    const fixture = await readFixture(mainFixtureName);
    const workbook = buildFiledReturnsGstr2bWorkbook(
      plan(),
      [sourceEntry(mainFixtureName, fixture)],
      {
        generatedAt: new Date("2026-09-09T00:00:00.000Z"),
      },
    );

    expect(workbook, "the main fixture must produce a workbook").not.toBeNull();
    expect(workbook?.includesItcSummary).toBe(true);

    const entries = extractStoredZipEntries(workbook!.bytes);
    expect(sheetNames(text(entries, "xl/workbook.xml"))).toEqual([
      "ITC summary",
      "B2B",
      "B2BA",
      "CDNR",
      "IMPG",
    ]);

    expect(sectionTotals(text(entries, "xl/worksheets/sheet2.xml"))).toEqual(EXPECTED_TOTALS.b2b);
    expect(sectionTotals(text(entries, "xl/worksheets/sheet3.xml"))).toEqual(EXPECTED_TOTALS.b2ba);
    expect(sectionTotals(text(entries, "xl/worksheets/sheet4.xml"))).toEqual(EXPECTED_TOTALS.cdnr);
    expect(sectionTotals(text(entries, "xl/worksheets/sheet5.xml"))).toEqual(EXPECTED_TOTALS.impg);

    const b2b = text(entries, "xl/worksheets/sheet2.xml");
    expect(dataRows(b2b)).toHaveLength(16);
    expect(dataRows(text(entries, "xl/worksheets/sheet3.xml"))).toHaveLength(1);
    expect(dataRows(text(entries, "xl/worksheets/sheet4.xml"))).toHaveLength(2);
    expect(dataRows(text(entries, "xl/worksheets/sheet5.xml"))).toHaveLength(1);

    // The builder identifies the unknown section, but its output has no ISD
    // record count or totals. The 40,000 / 7,200 cells below come independently
    // from data.itcsumm, not from the unrendered data.docdata.isd records.
    const coverage = coverageValue(b2b);
    expect(coverage).toContain("Sections present in the source but not rendered: isd.");
    expect(coverage).not.toContain("rows=2");
    expect(coverage).not.toContain("40000");
    expect(coverage).not.toContain("7200");
    const itcSummary = text(entries, "xl/worksheets/sheet1.xml");
    expect(itcSummary).toContain("40000");
    expect(itcSummary).toContain("7200");
  });

  it("groups counterparty documents and reconciles each portal control total", async () => {
    const fixture = JSON.parse(await readFixture(mainFixtureName)) as Gstr2bFixture;
    const { data } = fixture;

    expect(fixture.chksum).toBe("case-register-2b-01-synthetic");
    expect(data.gendt).toBe("14-08-2025");
    expect(data.version).toBe("1.0");

    const b2bGroups = data.docdata.b2b;
    expect(b2bGroups).toHaveLength(5);
    expect(b2bGroups.flatMap((group) => group.inv ?? [])).toHaveLength(16);
    expect(b2bGroups.every((group) => group.supfildt && group.supprd)).toBe(true);

    for (const group of [...data.docdata.b2b, ...data.docdata.b2ba]) {
      for (const invoice of group.inv ?? []) {
        expect(invoice).toEqual(expect.objectContaining(fullInvoiceFields()));
        expect(Object.keys(invoice)).toEqual(expect.arrayContaining(FULL_INVOICE_KEYS));
      }
    }
    for (const group of data.docdata.cdnr) {
      expect(group.nt).toHaveLength(1);
      for (const note of group.nt ?? []) {
        expect(note).toEqual(expect.objectContaining(fullNoteFields()));
      }
    }

    for (const section of ["b2b", "b2ba", "cdnr"] as const) {
      const documentKey = section === "cdnr" ? "nt" : "inv";
      expect(summaryTotalsByCounterparty(data.cpsumm[section])).toEqual(
        documentTotalsByCounterparty(data.docdata[section], documentKey),
      );
    }
  });

  it("keeps C-024's requested wrong GSTIN literal while leaving every other field identical", async () => {
    const main = JSON.parse(await readFixture(mainFixtureName));
    const wrong = JSON.parse(await readFixture(wrongGstinFixtureName));

    expect(wrong.data.gstin).toBe("27AABCB9999K1Z1");
    expect({ ...wrong.data, gstin: main.data.gstin }).toEqual(main.data);
  });
});

function plan(): FiledReturnsSummaryPlanEntry[] {
  return [
    {
      artifactType: "JSON",
      entryNames: [mainFixtureName],
      financialYear: "2025-26",
      outcomeCategory: "staged",
      period: "July",
      returnType: "GSTR-2B",
    },
  ];
}

type Gstr2bDocument = {
  ctin: string;
  supfildt: string;
  supprd: string;
  inv?: Array<Record<string, unknown>>;
  nt?: Array<Record<string, unknown>>;
};

type CounterpartySummary = {
  ctin: string;
  ttldocs: number;
  txval: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
};

type Gstr2bFixture = {
  chksum: string;
  data: {
    gendt: string;
    version: string;
    docdata: Record<"b2b" | "b2ba" | "cdnr", Gstr2bDocument[]>;
    cpsumm: Record<"b2b" | "b2ba" | "cdnr", CounterpartySummary[]>;
  };
};

function fullInvoiceFields(): Record<(typeof FULL_INVOICE_KEYS)[number], unknown> {
  return {
    inum: expect.any(String),
    ...fullDocumentFields(),
  };
}

function fullNoteFields() {
  return {
    ntnum: expect.any(String),
    ...fullDocumentFields(),
    suptyp: "R",
  };
}

function fullDocumentFields() {
  return {
    dt: expect.any(String),
    val: expect.any(Number),
    txval: expect.any(Number),
    igst: expect.any(Number),
    cgst: expect.any(Number),
    sgst: expect.any(Number),
    cess: expect.any(Number),
    pos: "27",
    rev: "N",
    typ: "R",
    itcavl: "Y",
    rsn: "",
    srctyp: "GSTR2B",
    irn: "",
    irngendate: "",
    imsStatus: "ACCEPTED",
  };
}

function documentTotalsByCounterparty(groups: Gstr2bDocument[], documentKey: "inv" | "nt") {
  return Object.fromEntries(
    groups.map((group) => {
      const documents = group[documentKey] ?? [];
      return [
        group.ctin,
        {
          ttldocs: documents.length,
          txval: total(documents, "txval"),
          igst: total(documents, "igst"),
          cgst: total(documents, "cgst"),
          sgst: total(documents, "sgst"),
          cess: total(documents, "cess"),
        },
      ];
    }),
  );
}

function summaryTotalsByCounterparty(summaries: CounterpartySummary[]) {
  return Object.fromEntries(
    summaries.map(({ ctin, ttldocs, txval, igst, cgst, sgst, cess }) => [
      ctin,
      { ttldocs, txval, igst, cgst, sgst, cess },
    ]),
  );
}

function total(documents: Array<Record<string, unknown>>, key: string): number {
  return documents.reduce((sum, document) => sum + Number(document[key]), 0);
}

function sourceEntry(path: string, fixture: string) {
  return { path, bytes: new TextEncoder().encode(fixture) };
}

async function readFixture(name: string): Promise<string> {
  return readFile(new URL(name, fixtureDirectory), "utf8");
}

async function readGenerated(directory: string, name: string): Promise<string> {
  return readFile(`${directory}/${name}`, "utf8");
}

function sectionTotals(xml: string): Record<string, number> {
  const rows = dataRows(xml);
  const headings = cells(columnHeadingRow(xml));
  return Object.fromEntries(
    ["txval", "igst", "cgst", "sgst"]
      .filter((key) => headings.includes(headingFor(key)))
      .map((key) => [key, rows.reduce((total, row) => total + numericCell(row, headings, key), 0)]),
  );
}

function dataRows(xml: string): string[] {
  const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((match) => match[1] ?? "");
  const headingIndex = rows.findIndex(
    (row) => cells(row).includes("Match key") || cells(row).includes("Period"),
  );
  const footerIndex = rows.findIndex(
    (row, index) => index > headingIndex && cells(row).includes("Source"),
  );
  if (headingIndex < 0) throw new Error("Workbook sheet has no column heading row.");
  return rows
    .slice(headingIndex + 1, footerIndex < 0 ? rows.length : footerIndex)
    .filter((row) => cells(row).length > 0);
}

function columnHeadingRow(xml: string): string {
  const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((match) => match[1] ?? "");
  const heading = rows.find(
    (row) => cells(row).includes("Match key") || cells(row).includes("Period"),
  );
  if (!heading) throw new Error("Workbook sheet has no column heading row.");
  return heading;
}

function coverageValue(xml: string): string {
  const coverageRow = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)]
    .map((match) => cells(match[1] ?? ""))
    .find((row) => row[0] === "Coverage");
  if (!coverageRow?.[1]) throw new Error("Workbook sheet has no coverage footer.");
  return coverageRow[1];
}

function numericCell(row: string, headings: string[], key: string): number {
  const index = headings.indexOf(headingFor(key));
  if (index < 0) throw new Error(`No ${key} heading in workbook section.`);
  const cellsByColumn = new Map(
    [...row.matchAll(/<c r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const value = cellsByColumn.get(columnName(index + 1));
  if (!value) return 0;
  const number = Number(value.match(/<v>([^<]+)<\/v>/)?.[1]);
  if (!Number.isFinite(number)) throw new Error(`Non-numeric ${key} cell.`);
  return number;
}

function headingFor(key: string): string {
  return { cgst: "CGST", igst: "IGST", sgst: "SGST", txval: "Taxable value" }[key] ?? key;
}

function cells(row: string): string[] {
  return [...row.matchAll(/<c[^>]*>([\s\S]*?)<\/c>/g)]
    .map((match) => match[1]?.match(/<t[^>]*>([\s\S]*?)<\/t>|<v>([^<]+)<\/v>/)?.slice(1))
    .map((value) => value?.find((candidate) => candidate !== undefined))
    .filter((value): value is string => value !== undefined);
}

function columnName(column: number): string {
  let value = column;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
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

function sheetNames(xml: string): string[] {
  return [...xml.matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1]!);
}

function text(entries: Map<string, Uint8Array>, path: string): string {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`Missing workbook part ${path}`);
  return new TextDecoder().decode(bytes);
}

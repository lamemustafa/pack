import { describe, expect, it } from "vitest";
import { buildFiledReturnsFullYearWorkbook } from "../../src/connectors/gst/filed-returns-full-year-workbook";
import {
  filedReturnsStatementCoverage,
  filedReturnsStatementLineItems,
} from "../../src/connectors/gst/filed-returns-summary-labels";
import {
  buildFiledReturnsSummarySheet,
  type FiledReturnsSummaryPlanEntry,
} from "../../src/connectors/gst/filed-returns-summary-sheet";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";

describe("filed-return full-year workbook", () => {
  it("builds the statement header from identity outside the return envelope", () => {
    const plan = fullYearPlan();
    const summary = buildFiledReturnsSummarySheet(plan, [
      {
        path: "april-data.json",
        bytes: new TextEncoder().encode(
          JSON.stringify({
            status: 1,
            data: {
              lglnm: "Synthetic Workbook Taxpayer",
              trdnm: "Synthetic Workbook Trade Name",
              arn: "SYNTHETIC-WORKBOOK-ARN",
              arnDt: "2026-05-01",
              authSig: "Synthetic Workbook Signatory",
              desig: "Synthetic Workbook Designation",
              r3b: {
                gstin: "00XXXXX0000X0Z0",
                ret_period: "042026",
                sup_details: {
                  osup_det: { txval: 10.25, iamt: 2, camt: 3, samt: 4, csamt: 5 },
                  osup_zero: { txval: 6, iamt: 7, camt: 81, samt: 82, csamt: 8 },
                  osup_nil_exmp: { txval: 9, iamt: 83, camt: 84, samt: 85, csamt: 86 },
                  isup_rev: { txval: 11, iamt: 12, camt: 13, samt: 14, csamt: 15 },
                  osup_nongst: { txval: 16, iamt: 87, camt: 88, samt: 89, csamt: 90 },
                },
                surrounding_decoy: { unlabeled_amount: 17.5 },
              },
            },
            response_decoy: "synthetic",
          }),
        ),
      },
    ]);
    const options = {
      generatedAt: new Date("2026-08-20T12:00:00.000Z"),
    };

    const first = buildFiledReturnsFullYearWorkbook(summary, plan, options);
    const second = buildFiledReturnsFullYearWorkbook(summary, plan, options);
    expect(second).toEqual(first);

    const entries = extractStoredZipEntries(first);
    expect(sheetNames(text(entries, "xl/workbook.xml"))).toEqual(["GSTR-3B Consolidated"]);

    const statement = text(entries, "xl/worksheets/sheet1.xml");
    const statementRows = parsedRows(statement);
    expect(statement).toContain('pane xSplit="1" ySplit="5" topLeftCell="B6"');
    expect(statementRows[0]?.get("A1")?.text).toBe("GSTIN");
    expect(statementRows[0]?.get("B1")?.text).toBe("00XXXXX0000X0Z0");
    expect(statementRows[1]?.get("A2")?.text).toBe("Legal name");
    expect(statementRows[1]?.get("B2")?.text).toBe("Synthetic Workbook Taxpayer");
    expect(statementRows[2]?.get("A3")?.text).toBe("Financial year");
    expect(statementRows[2]?.get("B3")?.text).toBe("2026-27");
    expect(statementRows[3]?.size).toBe(0);
    expect(statementRows[4]?.get("A5")?.text).toBe("Description");
    expect(statementRows[4]?.get("B5")).toMatchObject({ number: 46_113, style: "4" });
    expect(statementRows[4]?.get("B5")?.type).toBeUndefined();
    expect(statementRows[4]?.get("M5")?.number).toBe(46_447);
    expect(statementRows[4]?.get("N5")?.text).toBe("Total");
    expect(statementRows[5]?.get("A6")?.text).toContain("Table 3.1(a)");
    expect(statementRows[5]?.size).toBe(1);
    expect(statementRows[6]?.get("A7")?.text).toBe("Taxable Value");
    expect(statementRows[6]?.get("B7")).toMatchObject({ number: 10.25, style: "2" });
    expect(statementRows[6]?.has("C7")).toBe(false);
    const monthTotal = "BCDEFGHIJKLM"
      .split("")
      .reduce((total, column) => total + (statementRows[6]?.get(`${column}7`)?.number ?? 0), 0);
    expect(statementRows[6]?.get("N7")?.number).toBe(monthTotal);

    expect(subrowsAfter(statementRows, "Table 3.1(a)")).toEqual([
      "Taxable Value",
      "IGST",
      "CGST",
      "SGST",
      "Cess",
    ]);
    expect(subrowsAfter(statementRows, "Table 3.1(b)")).toEqual(["Taxable Value", "IGST", "Cess"]);
    expect(subrowsAfter(statementRows, "Table 3.1(c)")).toEqual(["Value"]);
    expect(subrowsAfter(statementRows, "Table 3.1(d)")).toEqual([
      "Taxable Value",
      "IGST",
      "CGST",
      "SGST",
      "Cess",
    ]);
    expect(subrowsAfter(statementRows, "Table 3.1(e)")).toEqual(["Value"]);
    for (const table of [
      "Table 4(A)(1)",
      "Table 4(A)(2)",
      "Table 4(A)(3)",
      "Table 4(A)(4)",
      "Table 4(A)(5)",
      "Table 4(B)(1)",
      "Table 4(B)(2)",
      "Table 4(C)",
      "Table 4(D)(1)",
      "Table 4(D)(2)",
    ]) {
      expect(subrowsAfter(statementRows, table)).toEqual(["IGST", "CGST", "SGST", "Cess"]);
    }

    const coverage = filedReturnsStatementCoverage();
    expect(coverage).toEqual({
      includedTables: ["3.1", "4"],
      excludedTables: ["3.1.1", "3.2", "5.1", "6.1"],
    });
    expect(
      filedReturnsStatementLineItems().some(
        (lineItem) =>
          lineItem.coverageTable === "3.1" && lineItem.sectionCaption.startsWith("Table 3.1.1"),
      ),
    ).toBe(false);
    const footerRows = statementRows.slice(-2);
    expect(statementRows.at(-3)?.size).toBe(0);
    expect(textValues(footerRows[0])).toEqual([
      "Source",
      "Filed GSTR-3B returns from the GST portal · 20 Aug 2026",
    ]);
    expect(textValues(footerRows[1])).toEqual([
      "Coverage",
      `Tables ${coverage.includedTables.join(" and ")}. Not included: ${coverage.excludedTables.join(", ")}.`,
    ]);
    const footerValues = footerRows.map((row) => [...row!.values()][1]!.text!);
    expect(Math.max(...footerValues.map((value) => value.length))).toBeLessThanOrEqual(55);
    expect(statement).toContain('<col min="2" max="2" width="58" customWidth="1"/>');
    const workbookText = [...entries.values()]
      .map((entry) => new TextDecoder().decode(entry))
      .join("\n");
    expect(workbookText).not.toContain("GSTR-9");
    expect(workbookText).not.toContain("pack-full-year-workbook-");
    for (const identity of ["00XXXXX0000X0Z0", "Synthetic Workbook Taxpayer"]) {
      expect(statement.match(new RegExp(identity, "g"))).toHaveLength(1);
      expect(new TextDecoder().decode(summary.dataBytes)).not.toContain(identity);
    }
    for (const excludedIdentity of [
      "Synthetic Workbook Trade Name",
      "SYNTHETIC-WORKBOOK-ARN",
      "2026-05-01",
      "Synthetic Workbook Signatory",
      "Synthetic Workbook Designation",
    ]) {
      expect(statement).not.toContain(excludedIdentity);
      expect(new TextDecoder().decode(summary.dataBytes)).not.toContain(excludedIdentity);
    }
    expect(statement).not.toContain("/surrounding_decoy/unlabeled_amount");
  });

  it("keeps the workbook when the legal name is missing", () => {
    const plan = fullYearPlan();
    const summary = buildFiledReturnsSummarySheet(plan, [
      {
        path: "april-data.json",
        bytes: new TextEncoder().encode(
          JSON.stringify({
            status: 1,
            data: {
              r3b: {
                gstin: "00XXXXX0000X0Z0",
                ret_period: "042026",
                sup_details: { osup_det: { txval: 1 } },
              },
            },
          }),
        ),
      },
    ]);

    const workbook = buildFiledReturnsFullYearWorkbook(summary, plan, {
      generatedAt: new Date("2026-08-19T12:00:00.000Z"),
    });
    const statement = text(extractStoredZipEntries(workbook), "xl/worksheets/sheet1.xml");
    const rows = parsedRows(statement);
    expect(rows[0]?.get("B1")?.text).toBe("00XXXXX0000X0Z0");
    expect(rows[1]?.get("B2")?.text ?? "").toBe("");
  });
});

function textValues(row: Map<string, ParsedCell> | undefined): Array<string | undefined> {
  return row ? [...row.values()].map((cell) => cell.text) : [];
}

function fullYearPlan(): FiledReturnsSummaryPlanEntry[] {
  return FILED_RETURNS_MONTHS.map((period) => ({
    artifactType: "JSON",
    entryNames: period === "April" ? ["april-data.json"] : [],
    financialYear: "2026-27",
    outcomeCategory: period === "April" ? "staged" : "artifact-unavailable",
    period,
    returnType: "GSTR-3B",
  }));
}

interface ParsedCell {
  number?: number;
  style?: string;
  text?: string;
  type?: string;
}

function parsedRows(xml: string): Map<string, ParsedCell>[] {
  return [...xml.matchAll(/<row r="\d+">([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells = new Map<string, ParsedCell>();
    for (const match of rowMatch[1]!.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = match[2]!;
      const body = match[3]!;
      const textMatch = /<t(?: [^>]*)?>([\s\S]*?)<\/t>/.exec(body);
      const numberMatch = /<v>([^<]+)<\/v>/.exec(body);
      cells.set(match[1]!, {
        ...(textMatch ? { text: decodeXml(textMatch[1]!) } : {}),
        ...(numberMatch ? { number: Number(numberMatch[1]) } : {}),
        ...(/ s="([^"]+)"/.exec(attributes)?.[1]
          ? { style: / s="([^"]+)"/.exec(attributes)![1] }
          : {}),
        ...(/ t="([^"]+)"/.exec(attributes)?.[1]
          ? { type: / t="([^"]+)"/.exec(attributes)![1] }
          : {}),
      });
    }
    return cells;
  });
}

function subrowsAfter(rows: readonly Map<string, ParsedCell>[], sectionPrefix: string): string[] {
  const start = rows.findIndex((row) => row.values().next().value?.text?.startsWith(sectionPrefix));
  if (start < 0) throw new Error(`Missing synthetic statement section ${sectionPrefix}`);
  const labels: string[] = [];
  for (const row of rows.slice(start + 1)) {
    if (row.size === 0) break;
    const label = row.values().next().value?.text;
    if (label) labels.push(label);
  }
  return labels;
}

function sheetNames(xml: string): string[] {
  return [...xml.matchAll(/<sheet name="([^"]+)"/g)].map((match) => decodeXml(match[1]!));
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

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

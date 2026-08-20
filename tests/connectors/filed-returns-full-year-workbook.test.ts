import { describe, expect, it } from "vitest";
import {
  buildFiledReturnsFullYearWorkbook,
  FILED_RETURNS_FULL_YEAR_WORKBOOK_FORMAT_VERSION,
} from "../../src/connectors/gst/filed-returns-full-year-workbook";
import {
  buildFiledReturnsSummarySheet,
  type FiledReturnsSummaryPlanEntry,
} from "../../src/connectors/gst/filed-returns-summary-sheet";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";

describe("filed-return full-year workbook", () => {
  it("emits the unchanged comparative statement and deduplicated run details", () => {
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
                lglnm: "Synthetic Workbook Taxpayer",
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
      generatedAt: new Date("2026-08-19T12:00:00.000Z"),
      packVersion: "0.0.0-synthetic",
    };

    const first = buildFiledReturnsFullYearWorkbook(summary, plan, options);
    const second = buildFiledReturnsFullYearWorkbook(summary, plan, options);
    expect(second).toEqual(first);

    const entries = extractStoredZipEntries(first);
    expect(sheetNames(text(entries, "xl/workbook.xml"))).toEqual([
      "GSTR-3B Consolidated",
      "Run details",
    ]);

    const statement = text(entries, "xl/worksheets/sheet1.xml");
    const statementRows = parsedRows(statement);
    expect(statementRows[0]?.get("A1")?.text).toBe("Description");
    expect(statementRows[0]?.get("B1")).toMatchObject({ number: 46_113, style: "4" });
    expect(statementRows[0]?.get("B1")?.type).toBeUndefined();
    expect(statementRows[0]?.get("M1")?.number).toBe(46_447);
    expect(statementRows[0]?.get("N1")?.text).toBe("Total");
    expect(statementRows[1]?.get("A2")?.text).toContain("Table 3.1(a)");
    expect(statementRows[1]?.size).toBe(1);
    expect(statementRows[2]?.get("A3")?.text).toBe("Taxable Value");
    expect(statementRows[2]?.get("B3")).toMatchObject({ number: 10.25, style: "2" });
    expect(statementRows[2]?.has("C3")).toBe(false);
    expect(statementRows[2]?.get("N3")?.number).toBe(10.25);

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

    const runDetails = text(entries, "xl/worksheets/sheet2.xml");
    const detailRows = parsedRows(runDetails);
    expect(detailRows[0]?.get("A1")?.text).toBe("Item");
    expect(detailRows[0]?.get("B1")?.text).toBe("Details");
    const detailKeys = detailRows
      .slice(1)
      .map((row, index) => row.get(`A${index + 2}`)?.text)
      .filter((key): key is string => key !== undefined);
    expect(new Set(detailKeys).size).toBe(detailKeys.length);
    for (const key of [
      "pack_version",
      "generated_at",
      "workbook_format_version",
      "tidy_data_format_version",
      "tidy_data_file",
    ]) {
      expect(detailKeys.filter((candidate) => candidate === key)).toHaveLength(1);
    }
    for (const key of [
      "financial_year",
      "return_types",
      "artifacts",
      "planned_periods",
      "included_statement_coverage",
      "excluded_statement_coverage",
      "gstr9_boundary",
      "envelope_rule",
      "array_rule",
      "number_rule",
      "text_rule",
      "label_rule",
      "identity_rule",
      "workbook_number_rule",
    ]) {
      expect(detailKeys).toContain(key);
    }
    expect(runDetails).toContain(FILED_RETURNS_FULL_YEAR_WORKBOOK_FORMAT_VERSION);
    expect(runDetails).toContain("2026-08-19T12:00:00.000Z");
    expect(runDetails).toContain("Verified labels for Form GSTR-3B Tables 3.1 and 4");
    expect(runDetails).toContain("This workbook does not produce GSTR-9 values");
    for (const identity of ["00XXXXX0000X0Z0", "Synthetic Workbook Taxpayer"]) {
      expect(runDetails.match(new RegExp(identity, "g"))).toHaveLength(1);
      expect(statement).not.toContain(identity);
    }
    expect([statement, runDetails].join("\n")).not.toContain("/surrounding_decoy/unlabeled_amount");
  });
});

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

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildFiledReturnsFullYearWorkbook,
  exactSpreadsheetNumber,
} from "../../src/connectors/gst/filed-returns-full-year-workbook";
import { XLSX_NUMBER_DECIMAL_PLACES } from "../../src/core/xlsx";
import {
  filedReturnsStatementCoverage,
  filedReturnsStatementLineItems,
} from "../../src/connectors/gst/filed-returns-summary-labels";
import {
  buildFiledReturnsSummarySheet,
  type FiledReturnsSummaryPlanEntry,
} from "../../src/connectors/gst/filed-returns-summary-sheet";
import {
  FILED_RETURNS_MONTHS,
  type FiledReturnsMonth,
} from "../../src/connectors/gst/filed-returns-scope";

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
                gstin: "27ABCDE1234F1Z0",
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
    expect(statementRows[0]?.get("B1")?.text).toBe("27ABCDE1234F1Z0");
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
    expect([
      ...new Set(
        filedReturnsStatementLineItems([{ financialYear: "2026-27", period: "March" }]).map(
          (lineItem) => lineItem.sectionCaption,
        ),
      ),
    ]).toEqual([
      "Table 3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted)",
      "Table 3.1(b) Outward taxable supplies (zero rated)",
      "Table 3.1(c) Other outward supplies (Nil rated, exempted)",
      "Table 3.1(d) Inward supplies (liable to reverse charge)",
      "Table 3.1(e) Non-GST outward supplies",
      "Table 4(A)(1) Import of goods",
      "Table 4(A)(2) Import of services",
      "Table 4(A)(3) Inward supplies liable to reverse charge (other than 1 & 2 above)",
      "Table 4(A)(4) Inward supplies from ISD",
      "Table 4(A)(5) All other ITC",
      "Table 4(B)(1) ITC reversed — As per rules 38, 42 & 43 of CGST Rules and sub-section (5) of section 17",
      "Table 4(B)(2) ITC reversed — Others",
      "Table 4(C) Net ITC available (A) − (B)",
      "Table 4(D)(1) Other Details — ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period",
      "Table 4(D)(2) Other Details — Ineligible ITC under section 16(4) & ITC restricted due to PoS rules",
    ]);
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

    const coverage = filedReturnsStatementCoverage([{ financialYear: "2026-27", period: "March" }]);
    expect(coverage).toEqual({
      includedTables: ["3.1", "4"],
      excludedTables: ["3.1.1", "3.2", "5", "5.1", "6.1"],
    });
    expect(
      filedReturnsStatementLineItems([{ financialYear: "2026-27", period: "March" }]).some(
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
    expect(Math.max(...footerValues.map((value) => value.length))).toBeLessThanOrEqual(58);
    expect(statement).toContain('<col min="2" max="2" width="58" customWidth="1"/>');
    const workbookText = [...entries.values()]
      .map((entry) => new TextDecoder().decode(entry))
      .join("\n");
    expect(workbookText).not.toContain("GSTR-9");
    expect(workbookText).not.toContain("pack-full-year-workbook-");
    for (const identity of ["27ABCDE1234F1Z0", "Synthetic Workbook Taxpayer"]) {
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

  it("fails closed when a parseable workbook period omits its legal name", () => {
    const plan = fullYearPlan();
    expect(() =>
      buildFiledReturnsSummarySheet(plan, [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            JSON.stringify({
              status: 1,
              data: {
                r3b: {
                  gstin: "27ABCDE1234F1Z0",
                  ret_period: "042026",
                  sup_details: { osup_det: { txval: 1 } },
                },
              },
            }),
          ),
        },
      ]),
    ).toThrow("Required taxpayer identity");
  });

  it("withholds mixed FY 2022-23 Table 4 captions without changing values or totals", () => {
    const plan = fullYearPlan("2022-23", "August");
    const summary = buildFiledReturnsSummarySheet(plan, [
      {
        path: "august-data.json",
        bytes: new TextEncoder().encode(
          JSON.stringify({
            status: 1,
            data: {
              lglnm: "Synthetic Workbook Taxpayer",
              r3b: {
                gstin: "27ABCDE1234F1Z0",
                ret_period: "082022",
                itc_elg: {
                  itc_rev: [{ ty: "RUL", camt: 12 }],
                  itc_inelg: [
                    { ty: "RUL", camt: 13 },
                    { ty: "OTH", camt: 14 },
                  ],
                },
              },
            },
          }),
        ),
      },
    ]);
    const statement = text(
      extractStoredZipEntries(
        buildFiledReturnsFullYearWorkbook(summary, plan, {
          generatedAt: new Date("2026-08-20T12:00:00.000Z"),
        }),
      ),
      "xl/worksheets/sheet1.xml",
    );
    const rows = parsedRows(statement);
    const withheldCaptions = rows
      .map((row) => row.values().next().value?.text)
      .filter((value): value is string =>
        ["Table 4(B)(1)", "Table 4(D)(1)", "Table 4(D)(2)"].includes(value ?? ""),
      );
    expect(withheldCaptions).toEqual(["Table 4(B)(1)", "Table 4(D)(1)", "Table 4(D)(2)"]);
    const statementNumbers = rows.flatMap((row) => [...row.values()].map((cell) => cell.number));
    expect(statementNumbers).toEqual(expect.arrayContaining([12, 13, 14]));
    expect(statement).toContain(
      "Withheld captions: Table 4(B)(1), Table 4(D)(1), and Table 4(D)(2).",
    );
  });

  it("restores current Table 4 captions for FY 2025-26", () => {
    const filingPeriods = filingPeriodsForFinancialYear("2025-26");
    const captions = filedReturnsStatementLineItems(filingPeriods).map(
      (lineItem) => lineItem.sectionCaption,
    );
    expect(captions).toEqual(expect.arrayContaining(currentTable4Captions()));
    expect(filedReturnsStatementCoverage(filingPeriods)).not.toHaveProperty(
      "withheldCaptionTables",
    );
  });

  it("uses captured current captions and withholds years before the evidence range", () => {
    expect(
      filedReturnsStatementLineItems(filingPeriodsForFinancialYear("2021-22")).find((item) =>
        item.sectionCaption.startsWith("Table 4(D)(1)"),
      )?.sectionCaption,
    ).toBe("Table 4(D)(1)");
    expect(
      filedReturnsStatementLineItems(filingPeriodsForFinancialYear("2017-18")).find((item) =>
        item.sectionCaption.startsWith("Table 4(D)(1)"),
      )?.sectionCaption,
    ).toBe("Table 4(D)(1)");
    for (const financialYear of ["2023-24", "2024-25"]) {
      expect(
        filedReturnsStatementLineItems(filingPeriodsForFinancialYear(financialYear)).map(
          (item) => item.sectionCaption,
        ),
      ).toEqual(expect.arrayContaining(currentTable4Captions()));
    }
  });

  it("marks an array at a mapped statement path instead of rendering its length", () => {
    const plan = fullYearPlan();
    // `txval: [100]` flattens to an array-count row whose numeric column is the
    // array's length, not the amount. Rendered as a figure it would show 1 and
    // be summed into the total.
    const summary = buildFiledReturnsSummarySheet(plan, [
      {
        path: "april-data.json",
        bytes: new TextEncoder().encode(
          '{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","sup_details":{"osup_det":{"txval":[100]}}}}}',
        ),
      },
    ]);
    const workbook = buildFiledReturnsFullYearWorkbook(summary, plan, {
      generatedAt: new Date("2026-08-19T12:00:00.000Z"),
    });
    const rows = parsedRows(text(extractStoredZipEntries(workbook), "xl/worksheets/sheet1.xml"));
    const cells = [...rows.values()].flatMap((row) => [...row.values()]);
    const texts = cells.map((cell) => cell.text ?? "");
    const numbers = cells.map((cell) => cell.number ?? "");

    expect(texts).toContain("Non-numeric value");
    // The array length must not appear as a figure anywhere.
    expect(numbers).not.toContain("1");
  });

  it("refuses a total when a month is a numeric-looking string", () => {
    const plan = fullYearPlan();
    // "100" parses as a decimal, so it was summed into the total while its own
    // month rendered `Non-numeric value` -- a figure asserting a sum containing a
    // value the sheet had just declared unusable.
    const summary = buildFiledReturnsSummarySheet(plan, [
      {
        path: "april-data.json",
        bytes: new TextEncoder().encode(
          '{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","sup_details":{"osup_det":{"txval":"100"}}}}}',
        ),
      },
    ]);
    const workbook = buildFiledReturnsFullYearWorkbook(summary, plan, {
      generatedAt: new Date("2026-08-19T12:00:00.000Z"),
    });
    const rows = parsedRows(text(extractStoredZipEntries(workbook), "xl/worksheets/sheet1.xml"));
    const cells = [...rows.values()].flatMap((row) => [...row.values()]);
    const texts = cells.map((cell) => cell.text ?? "");

    expect(texts).toContain("Non-numeric value");
    expect(texts).toContain("Total unavailable: a month is non-numeric");
    // The parsed value must not appear as a figure anywhere.
    expect(cells.map((cell) => cell.number ?? "")).not.toContain("100");
  });

  it("withholds every total and names an unavailable workbook period", () => {
    const plan = FILED_RETURNS_MONTHS.map((period) => ({
      artifactType: "JSON" as const,
      entryNames: period === "April" ? ["april-data.json"] : [],
      financialYear: "2026-27",
      outcomeCategory:
        period === "April"
          ? ("staged" as const)
          : period === "May"
            ? ("artifact-unavailable" as const)
            : ("not-filed" as const),
      period,
      returnType: "GSTR-3B" as const,
    }));
    const summary = buildFiledReturnsSummarySheet(plan, [
      {
        path: "april-data.json",
        bytes: new TextEncoder().encode(
          '{"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","sup_details":{"osup_det":{"txval":1}}}}}',
        ),
      },
    ]);
    const rows = parsedRows(
      text(
        extractStoredZipEntries(
          buildFiledReturnsFullYearWorkbook(summary, plan, {
            generatedAt: new Date("2026-08-20T12:00:00.000Z"),
          }),
        ),
        "xl/worksheets/sheet1.xml",
      ),
    );
    const taxableValueRow = rows.find((row) => row.get("A7")?.text === "Taxable Value");
    const coverageRow = rows.find((row) => row.values().next().value?.text === "Coverage");

    expect(taxableValueRow?.get("N7")).toBeUndefined();
    expect(statementTotalCells(rows)).toEqual([]);
    expect([...coverageRow!.values()][1]?.text).toContain("Unreadable periods: May.");
  });

  it("keeps totals when a period was not filed", () => {
    const valuesByPeriod = new Map(
      FILED_RETURNS_MONTHS.map((period, index) => [period, index + 1]),
    );
    const plan = FILED_RETURNS_MONTHS.map((period) => ({
      artifactType: "JSON" as const,
      entryNames: period === "May" ? [] : [`${period.toLowerCase()}-data.json`],
      financialYear: "2026-27",
      outcomeCategory: period === "May" ? ("not-filed" as const) : ("staged" as const),
      period,
      returnType: "GSTR-3B" as const,
    }));
    const summary = buildFiledReturnsSummarySheet(
      plan,
      plan
        .filter((entry) => entry.outcomeCategory === "staged")
        .map((entry) =>
          gstr3bStatementEntry(entry.period, { txval: valuesByPeriod.get(entry.period)! }),
        ),
    );
    const rows = workbookRows(summary, plan);
    const taxableValueRow = rows.find((row) => row.get("A7")?.text === "Taxable Value");

    expect(taxableValueRow?.get("N7")).toMatchObject({ number: 76, style: "2" });
  });

  it("keeps totals when a parsed period omits a particular statement field", () => {
    const plan = FILED_RETURNS_MONTHS.map((period) => ({
      artifactType: "JSON" as const,
      entryNames: [`${period.toLowerCase()}-data.json`],
      financialYear: "2026-27",
      outcomeCategory: "staged" as const,
      period,
      returnType: "GSTR-3B" as const,
    }));
    const summary = buildFiledReturnsSummarySheet(
      plan,
      plan.map((entry) =>
        gstr3bStatementEntry(entry.period, entry.period === "May" ? { iamt: 2 } : { txval: 1 }),
      ),
    );
    const rows = workbookRows(summary, plan);
    const taxableValueRow = rows.find((row) => row.get("A7")?.text === "Taxable Value");

    expect(taxableValueRow?.get("N7")).toMatchObject({ number: 11, style: "2" });
  });

  // Significant digits do not bound decimal places: `0.0000000000000001` has one
  // significant digit and sixteen decimals, so the old rule admitted it. The
  // cell format cannot render that, and a stored value the sheet displays as
  // zero is the exact defect the wider format was meant to remove -- surviving
  // past the new boundary rather than at the old one. It takes the same
  // `Precision limit` treatment an unrepresentable value already gets.
  it("refuses a value with more decimals than a cell can display", () => {
    const withinFormat = `0.${"0".repeat(XLSX_NUMBER_DECIMAL_PLACES - 1)}1`;
    const beyondFormat = `0.${"0".repeat(XLSX_NUMBER_DECIMAL_PLACES)}1`;

    expect(withinFormat.split(".")[1]).toHaveLength(XLSX_NUMBER_DECIMAL_PLACES);
    expect(exactSpreadsheetNumber(withinFormat)).not.toBeNull();
    expect(exactSpreadsheetNumber(beyondFormat)).toBeNull();
  });

  // The ordinary case must not be caught by the new rule.
  it("keeps admitting the decimals a portal amount actually carries", () => {
    expect(exactSpreadsheetNumber("12.50")).toBe(12.5);
    expect(exactSpreadsheetNumber("0.001")).toBe(0.001);
    expect(exactSpreadsheetNumber("1.234")).toBe(1.234);
    expect(exactSpreadsheetNumber("-2650.75")).toBe(-2650.75);
  });

  it("keeps a fully filed workbook byte-identical", () => {
    // The digest is only stable because the suite pins TZ=UTC. ZIP entry headers
    // carry a DOS date built from local-time getters, so this assertion silently
    // encodes whichever zone last regenerated it -- it was pinned in IST and
    // failed in CI and nowhere else.
    const plan = FILED_RETURNS_MONTHS.map((period) => ({
      artifactType: "JSON" as const,
      entryNames: [`${period.toLowerCase()}-data.json`],
      financialYear: "2026-27",
      outcomeCategory: "staged" as const,
      period,
      returnType: "GSTR-3B" as const,
    }));
    const summary = buildFiledReturnsSummarySheet(
      plan,
      plan.map((entry) => gstr3bStatementEntry(entry.period, { txval: 1 })),
    );
    const workbook = buildFiledReturnsFullYearWorkbook(summary, plan, {
      generatedAt: new Date("2026-08-20T12:00:00.000Z"),
    });

    // Rolled once, for the number format widening in #167. The regenerated
    // workbook was unzipped and diffed against the previously validated one
    // entry by entry: `xl/styles.xml` differed in exactly one attribute,
    // `formatCode="#,##0.00"` becoming `"#,##0.00#############"`, and every
    // sheet, cell value and shared string was byte-identical. That diff is the
    // evidence that totals, the `Precision limit` marker and the exact-decimal
    // path are untouched -- a rolled digest asserts nothing on its own.
    expect(createHash("sha256").update(workbook).digest("hex")).toBe(
      "fedc3860070cd4fd3d66190090669b56a70442bb2111a355533c2c597429cf3d",
    );
  });

  it("withholds every total when staged JSON cannot be parsed", () => {
    const plan = FILED_RETURNS_MONTHS.map((period) => ({
      artifactType: "JSON" as const,
      entryNames:
        period === "April" || period === "May" ? [`${period.toLowerCase()}-data.json`] : [],
      financialYear: "2026-27",
      outcomeCategory:
        period === "April" || period === "May" ? ("staged" as const) : ("not-filed" as const),
      period,
      returnType: "GSTR-3B" as const,
    }));
    const summary = buildFiledReturnsSummarySheet(plan, [
      gstr3bStatementEntry("April", { txval: 1 }),
      { path: "may-data.json", bytes: new TextEncoder().encode("{") },
    ]);
    const rows = workbookRows(summary, plan);
    const taxableValueRow = rows.find((row) => row.get("A7")?.text === "Taxable Value");
    const coverageRow = rows.find((row) => row.values().next().value?.text === "Coverage");

    expect(taxableValueRow?.get("N7")).toBeUndefined();
    expect(statementTotalCells(rows)).toEqual([]);
    expect([...coverageRow!.values()][1]?.text).toContain("Unreadable periods: May.");
  });

  it("dates the Source footer from local components, not UTC", () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "Asia/Kolkata";
    try {
      const plan = fullYearPlan();
      const summary = buildFiledReturnsSummarySheet(plan, []);
      // 19:00 UTC is 00:30 the next day in Asia/Kolkata. A UTC-derived footer
      // would label this export with the previous calendar day.
      const generatedAt = new Date("2026-08-20T19:00:00.000Z");
      const workbook = buildFiledReturnsFullYearWorkbook(summary, plan, { generatedAt });
      const rows = parsedRows(text(extractStoredZipEntries(workbook), "xl/worksheets/sheet1.xml"));
      const footer = [...rows.values()]
        .flatMap((row) => [...row.values()])
        .map((cell) => cell.text ?? "")
        .find((value) => value.startsWith("Filed GSTR-3B returns from the GST portal"));

      expect(footer).toContain("21 Aug 2026");
      expect(footer).not.toContain("20 Aug 2026");
    } finally {
      process.env.TZ = originalTimeZone;
    }
  });

  it("keeps blank identity cells when no period has parseable JSON", () => {
    const plan = fullYearPlan().map((entry) => ({
      ...entry,
      entryNames: [],
      outcomeCategory: "artifact-unavailable" as const,
    }));
    const summary = buildFiledReturnsSummarySheet(plan, []);
    const workbook = buildFiledReturnsFullYearWorkbook(summary, plan, {
      generatedAt: new Date("2026-08-19T12:00:00.000Z"),
    });
    const rows = parsedRows(text(extractStoredZipEntries(workbook), "xl/worksheets/sheet1.xml"));
    expect(rows[0]?.get("B1")?.text ?? "").toBe("");
    expect(rows[1]?.get("B2")?.text ?? "").toBe("");
  });
  it("sums twelve large monthly decimals exactly from their source text", () => {
    const plan = FILED_RETURNS_MONTHS.map((period) => ({
      artifactType: "JSON" as const,
      entryNames: [`${period.toLowerCase()}-data.json`],
      financialYear: "2026-27",
      outcomeCategory: "staged" as const,
      period,
      returnType: "GSTR-3B" as const,
    }));
    const entries = plan.map(({ entryNames, period }) => ({
      path: entryNames[0]!,
      bytes: new TextEncoder().encode(
        JSON.stringify({
          data: {
            lglnm: "Synthetic Legal Name",
            r3b: {
              gstin: "27ABCDE1234F1Z0",
              ret_period: period,
              sup_details: { osup_det: { txval: 9_999_999_999_999.99 } },
            },
          },
        }),
      ),
    }));
    const summary = buildFiledReturnsSummarySheet(plan, entries);
    const workbook = buildFiledReturnsFullYearWorkbook(summary, plan, {
      generatedAt: new Date("2026-08-20T12:00:00.000Z"),
    });
    const statement = text(extractStoredZipEntries(workbook), "xl/worksheets/sheet1.xml");
    const taxableValueRow = parsedRows(statement).find(
      (row) => row.get("A7")?.text === "Taxable Value",
    );

    for (const column of "BCDEFGHIJKLM") {
      expect(taxableValueRow?.get(`${column}7`)).toMatchObject({
        number: 9_999_999_999_999.99,
        style: "2",
      });
    }
    expect(taxableValueRow?.get("N7")).toMatchObject({
      text: "Exact total 119999999999999.88 unavailable at spreadsheet numeric precision",
      type: "inlineStr",
    });
    expect(statement).toContain("119999999999999.88");
    expect(statement).not.toContain("119999999999999.86");
  });

  it("keeps an underflowing month distinct from genuine zero and a missing period", () => {
    const plan = FILED_RETURNS_MONTHS.map((period) => {
      const staged = period === "April" || period === "May";
      return {
        artifactType: "JSON" as const,
        entryNames: staged ? [`${period.toLowerCase()}-data.json`] : [],
        financialYear: "2026-27",
        outcomeCategory: staged ? ("staged" as const) : ("not-filed" as const),
        period,
        returnType: "GSTR-3B" as const,
      };
    });
    const entries = [
      {
        path: "april-data.json",
        bytes: new TextEncoder().encode(
          '{"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","sup_details":{"osup_det":{"txval":1e-400}}}}}',
        ),
      },
      {
        path: "may-data.json",
        bytes: new TextEncoder().encode(
          '{"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"052026","sup_details":{"osup_det":{"txval":0}}}}}',
        ),
      },
    ];
    const summary = buildFiledReturnsSummarySheet(plan, entries);
    const statement = text(
      extractStoredZipEntries(
        buildFiledReturnsFullYearWorkbook(summary, plan, {
          generatedAt: new Date("2026-08-20T12:00:00.000Z"),
        }),
      ),
      "xl/worksheets/sheet1.xml",
    );
    const taxableValueRow = parsedRows(statement).find(
      (row) => row.get("A7")?.text === "Taxable Value",
    );
    const exactUnderflow = `0.${"0".repeat(399)}1`;

    expect(taxableValueRow?.get("B7")).toMatchObject({
      text: "Precision limit",
      type: "inlineStr",
    });
    expect(taxableValueRow?.get("B7")?.number).toBeUndefined();
    expect(taxableValueRow?.get("C7")).toMatchObject({ number: 0, style: "2" });
    expect(taxableValueRow?.has("D7")).toBe(false);
    expect(taxableValueRow?.get("N7")).toMatchObject({
      text: `Exact total ${exactUnderflow} unavailable at spreadsheet numeric precision`,
      type: "inlineStr",
    });
  });

  it("keeps both derived artifacts when an exact total exceeds the Excel cell limit", () => {
    const oversized = "1e-40000";
    const plan = fullYearPlan("2026-27", "April");
    const summary = buildFiledReturnsSummarySheet(plan, [
      {
        path: "april-data.json",
        bytes: new TextEncoder().encode(
          `{"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","sup_details":{"osup_det":{"txval":2,"iamt":${oversized}}}}}}`,
        ),
      },
    ]);
    const statement = text(
      extractStoredZipEntries(
        buildFiledReturnsFullYearWorkbook(summary, plan, {
          generatedAt: new Date("2026-08-20T12:00:00.000Z"),
        }),
      ),
      "xl/worksheets/sheet1.xml",
    );
    const rows = parsedRows(statement);
    const taxableValueRow = rows.find((row) => row.get("A7")?.text === "Taxable Value");
    const igstRow = rows.find((row) => row.get("A8")?.text === "IGST");

    expect(summary.dataBytes.byteLength).toBeGreaterThan(32_767);
    expect(taxableValueRow?.get("B7")).toMatchObject({ number: 2, style: "2" });
    expect(taxableValueRow?.get("N7")).toMatchObject({ number: 2, style: "2" });
    expect(igstRow?.get("B8")).toMatchObject({ text: "Precision limit", type: "inlineStr" });
    expect(igstRow?.get("N8")).toMatchObject({
      text: "Exact total unavailable at spreadsheet numeric precision",
      type: "inlineStr",
    });
  });

  it("does not publish a partial total when a present month exceeds numeric precision", () => {
    const plan = FILED_RETURNS_MONTHS.map((period) => {
      const staged = period === "April" || period === "May";
      return {
        artifactType: "JSON" as const,
        entryNames: staged ? [`${period.toLowerCase()}-data.json`] : [],
        financialYear: "2026-27",
        outcomeCategory: staged ? ("staged" as const) : ("not-filed" as const),
        period,
        returnType: "GSTR-3B" as const,
      };
    });
    const entries = [
      {
        path: "april-data.json",
        bytes: new TextEncoder().encode(
          '{"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","sup_details":{"osup_det":{"txval":99999999999999.999}}}}}',
        ),
      },
      {
        path: "may-data.json",
        bytes: new TextEncoder().encode(
          '{"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"052026","sup_details":{"osup_det":{"txval":1}}}}}',
        ),
      },
    ];
    const summary = buildFiledReturnsSummarySheet(plan, entries);
    const statement = text(
      extractStoredZipEntries(
        buildFiledReturnsFullYearWorkbook(summary, plan, {
          generatedAt: new Date("2026-08-20T12:00:00.000Z"),
        }),
      ),
      "xl/worksheets/sheet1.xml",
    );
    const taxableValueRow = parsedRows(statement).find(
      (row) => row.get("A7")?.text === "Taxable Value",
    );

    expect(taxableValueRow?.get("B7")).toMatchObject({
      text: "Precision limit",
      type: "inlineStr",
    });
    expect(taxableValueRow?.get("C7")).toMatchObject({ number: 1, style: "2" });
    expect(taxableValueRow?.get("N7")).toMatchObject({
      text: "Exact total 100000000000000.999 unavailable at spreadsheet numeric precision",
      type: "inlineStr",
    });
  });

  it("marks a non-numeric mapped statement value instead of dropping it from month and total", () => {
    const staged: readonly FiledReturnsMonth[] = ["April", "May", "June", "July"];
    const plan = FILED_RETURNS_MONTHS.map((period) => ({
      artifactType: "JSON" as const,
      entryNames: staged.includes(period) ? [`${period.toLowerCase()}-data.json`] : [],
      financialYear: "2026-27",
      outcomeCategory: staged.includes(period) ? ("staged" as const) : ("not-filed" as const),
      period,
      returnType: "GSTR-3B" as const,
    }));
    const entries = (
      [
        ["april-data.json", "042026", '"1,234.50"'],
        ["may-data.json", "052026", "true"],
        ["june-data.json", "062026", "null"],
        ["july-data.json", "072026", "5"],
      ] as const
    ).map(([path, returnPeriod, txval]) => ({
      path,
      bytes: new TextEncoder().encode(
        `{"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"${returnPeriod}","sup_details":{"osup_det":{"txval":${txval}}}}}}`,
      ),
    }));
    const summary = buildFiledReturnsSummarySheet(plan, entries);
    const statement = text(
      extractStoredZipEntries(
        buildFiledReturnsFullYearWorkbook(summary, plan, {
          generatedAt: new Date("2026-08-20T12:00:00.000Z"),
        }),
      ),
      "xl/worksheets/sheet1.xml",
    );
    const taxableValueRow = parsedRows(statement).find(
      (row) => row.get("A7")?.text === "Taxable Value",
    );

    for (const column of ["B7", "C7", "D7"]) {
      expect(taxableValueRow?.get(column)).toMatchObject({
        text: "Non-numeric value",
        type: "inlineStr",
      });
      expect(taxableValueRow?.get(column)?.number).toBeUndefined();
    }
    expect(taxableValueRow?.get("E7")).toMatchObject({ number: 5, style: "2" });
    expect(taxableValueRow?.get("N7")).toMatchObject({
      text: "Total unavailable: a month is non-numeric",
      type: "inlineStr",
    });
  });
});

function workbookRows(
  summary: ReturnType<typeof buildFiledReturnsSummarySheet>,
  plan: readonly FiledReturnsSummaryPlanEntry[],
): Map<string, ParsedCell>[] {
  return parsedRows(
    text(
      extractStoredZipEntries(
        buildFiledReturnsFullYearWorkbook(summary, plan, {
          generatedAt: new Date("2026-08-20T12:00:00.000Z"),
        }),
      ),
      "xl/worksheets/sheet1.xml",
    ),
  );
}

function gstr3bStatementEntry(period: FiledReturnsMonth, values: Record<string, number>) {
  return {
    path: `${period.toLowerCase()}-data.json`,
    bytes: new TextEncoder().encode(
      JSON.stringify({
        data: {
          lglnm: "Synthetic Legal Name",
          r3b: {
            gstin: "27ABCDE1234F1Z0",
            ret_period: period,
            sup_details: { osup_det: values },
          },
        },
      }),
    ),
  };
}

function statementTotalCells(rows: readonly Map<string, ParsedCell>[]) {
  const statementLabels = new Set<string>(
    filedReturnsStatementLineItems(filingPeriodsForFinancialYear("2026-27")).map(
      (lineItem) => lineItem.shortLabel,
    ),
  );
  return rows
    .filter((row) => statementLabels.has(row.values().next().value?.text ?? ""))
    .flatMap((row) => [...row.entries()].filter(([reference]) => reference.startsWith("N")));
}

function textValues(row: Map<string, ParsedCell> | undefined): Array<string | undefined> {
  return row ? [...row.values()].map((cell) => cell.text) : [];
}

function fullYearPlan(
  financialYear = "2026-27",
  populatedPeriod: FiledReturnsMonth = "April",
): FiledReturnsSummaryPlanEntry[] {
  return FILED_RETURNS_MONTHS.map((period) => ({
    artifactType: "JSON",
    entryNames: period === populatedPeriod ? [`${period.toLowerCase()}-data.json`] : [],
    financialYear,
    outcomeCategory: period === populatedPeriod ? "staged" : "not-filed",
    period,
    returnType: "GSTR-3B",
  }));
}

function filingPeriodsForFinancialYear(financialYear: string) {
  return FILED_RETURNS_MONTHS.map((period) => ({ financialYear, period }));
}

function currentTable4Captions() {
  return [
    "Table 4(B)(1) ITC reversed — As per rules 38, 42 & 43 of CGST Rules and sub-section (5) of section 17",
    "Table 4(D)(1) Other Details — ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period",
    "Table 4(D)(2) Other Details — Ineligible ITC under section 16(4) & ITC restricted due to PoS rules",
  ];
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

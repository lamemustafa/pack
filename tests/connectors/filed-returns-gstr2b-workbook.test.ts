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

    expect(sheetNames(text(entries, "xl/workbook.xml"))).toEqual([
      "ITC summary",
      "B2B",
      "B2BA",
      "CDNR",
      "IMPG",
    ]);
    expect(text(entries, "xl/workbook.xml")).not.toContain(COUNTERPARTY_GSTIN);

    const b2b = text(entries, "xl/worksheets/sheet2.xml");
    // Twice per row now: once in the match key, once in its own column.
    expect(b2b.match(new RegExp(COUNTERPARTY_GSTIN, "g"))).toHaveLength(4);
    expect(b2b.match(/Synthetic Counterparty Private Limited/g)).toHaveLength(2);
    expect(b2b).toContain("INV-001");
    expect(b2b).toContain("INV-002");
    expect(b2b).toContain("<v>110</v>");
    expect(b2b).toContain('pane xSplit="1"');
    expect(b2b).toContain("B2B invoice-level records present in the captured JSON.");
    expect(b2b).not.toContain("/data/");
    expect(b2b.match(new RegExp(OWNER_GSTIN, "g"))).toHaveLength(1);
    expect(b2b.match(/Synthetic Owner Legal Name/g)).toHaveLength(1);
    expect(b2b.match(/Synthetic Owner Trade Name/g)).toHaveLength(1);

    for (const sheet of ["sheet3.xml", "sheet4.xml", "sheet5.xml"]) {
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

    for (const sheet of ["sheet2.xml", "sheet3.xml", "sheet4.xml", "sheet5.xml"]) {
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

    for (const sheet of ["sheet2.xml", "sheet3.xml", "sheet4.xml"]) {
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
    expect(sheetNames(text(extractStoredZipEntries(workbook), "xl/workbook.xml"))).toEqual([
      "ITC summary",
      "B2B",
    ]);
  });

  // The workbook footer already promised that unconfirmed portal sections are
  // excluded, while the builder rejected the whole run when it met one. That
  // discarded the tidy CSV too, so a taxpayer whose GSTR-2B carries a section
  // this build does not render lost the artifact that does not depend on it.

  // Section names are portal-controlled text. Naming an unrecognised section in
  // the footer copies a key this build never validated into the artifact, and a
  // GSTIN or PAN can arrive as an ordinary object key -- which is why the tidy
  // CSV refuses that shape in a path segment. The footer had no such screen.
  it.each([
    ["a GSTIN-keyed section", COUNTERPARTY_GSTIN],
    ["a PAN-keyed section", "ABCDE1234F"],
    ["an owner-trade-name-keyed section", "Synthetic Owner Trade Name"],
  ])("withholds %s from the footer while still counting it", (_label, sectionKey) => {
    const data = { ...docdata(), [sectionKey]: [{}] } as ReturnType<typeof docdata>;
    const b2b = text(extractStoredZipEntries(buildWorkbook(data)), "xl/worksheets/sheet2.xml");

    // Asserted on the footer, not the whole sheet: the counterparty GSTIN
    // belongs in the invoice rows and the owner trade name belongs in the
    // header, so a whole-sheet assertion would fail on correct output -- and
    // the sample PAN is a substring of the owner GSTIN besides.
    expect(b2b).not.toContain("not rendered:");
    expect(b2b).toContain("1 further section name(s) withheld");
  });

  it("renders known sections and names an unrendered one instead of refusing", () => {
    const data = { ...docdata(), isd: [{ ctin: "27ABCDE1000F1ZC" }] } as ReturnType<typeof docdata>;
    const entries = extractStoredZipEntries(buildWorkbook(data));

    expect(sheetNames(text(entries, "xl/workbook.xml"))).toEqual([
      "ITC summary",
      "B2B",
      "B2BA",
      "CDNR",
      "IMPG",
    ]);
    const b2b = text(entries, "xl/worksheets/sheet2.xml");
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
  // 2. `irn`, `irngendate` and `srctyp` are optional -- present on some invoice
  //    records and absent from others in one period -- and every fixture above
  //    over-specified them by always supplying all three;
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

    const entries = extractStoredZipEntries(workbook!.bytes);
    expect(sheetNames(text(entries, "xl/workbook.xml"))).toEqual(["ITC summary", "B2B"]);
    const b2b = text(entries, "xl/worksheets/sheet2.xml");
    expect(b2b).toContain("INV-900");
    // The capture carries no `lglnm` or `trdnm`, so those header rows are not
    // written at all. Printing them regardless produced a labelled blank -- a
    // field that looks reported and is not.
    expect(b2b).not.toContain("Legal name");
    expect(b2b).not.toContain("Trade name");
    expect(b2b).toContain("GSTIN");
    expect(b2b).toContain(COUNTERPARTY_GSTIN);
    // The unread siblings are not a reason to exclude anything, and must not
    // leak into the sheet.
    expect(b2b).not.toContain("cpsumm");
    expect(b2b).not.toContain("itcsumm");
    expect(b2b).not.toContain("Sections present in the source but not rendered");
  });

  // JSON.parse keeps the last of a duplicate key; the canonical parser the tidy
  // CSV uses refuses the document outright. Without the same boundary here, a
  // period the CSV called unparseable could still produce a workbook from tax
  // values whose duplicates were resolved arbitrarily -- inside a ZIP whose own
  // message said no parseable portal JSON was available.
  it("refuses a source the canonical parser rejects for duplicate keys", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const body = JSON.stringify({
      data: {
        gstin: OWNER_GSTIN,
        lglnm: "Synthetic Owner Legal Name",
        trdnm: "Synthetic Owner Trade Name",
        rtnprd: "042026",
        docdata: docdata(),
      },
    });
    const withDuplicate = body.replace('"rtnprd":"042026"', '"rtnprd":"042026","rtnprd":"052026"');
    expect(withDuplicate).not.toBe(body);

    expect(() =>
      buildFiledReturnsGstr2bWorkbook(
        plan,
        [{ path: "april-data.json", bytes: new TextEncoder().encode(withDuplicate) }],
        { generatedAt: new Date("2026-08-22T12:00:00.000Z") },
      ),
    ).toThrow(/not canonically parseable/);
  });

  // The portal writes ITC summary totals in scientific notation. An earlier
  // version of the exact-number guard tested tokens against a hand-written
  // decimal grammar, with a comment asserting the portal does not emit exponent
  // form -- so it refused documents carrying them, for values that never reach a
  // cell.
  it("accepts exponent-form numbers the portal actually emits", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: {
          gstin: OWNER_GSTIN,
          rtnprd: "042026",
          docdata: docdata(),
          itcsumm: {
            itcavl: { nonrevsup: { b2b: { sgst: 0, cgst: 0, igst: 0, cess: 0, txval: 0 } } },
          },
        },
      }).replace('"sgst":0,"cgst":0', '"sgst":1.111111E1,"cgst":2.222222E2'),
    );

    const workbook = buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
      generatedAt: new Date("2026-08-22T12:00:00.000Z"),
    });
    expect(workbook, "an exponent-form total refused the whole workbook").not.toBeNull();
  });

  // Still refused when the exponent form genuinely cannot be represented.
  it("refuses an exponent-form value beyond spreadsheet precision", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: { gstin: OWNER_GSTIN, rtnprd: "042026", docdata: docdata() },
      }).replace('"val":110', '"val":1.11111111111111111E5'),
    );

    expect(() =>
      buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
        generatedAt: new Date("2026-08-22T12:00:00.000Z"),
      }),
    ).toThrow(/cannot be written to a spreadsheet without changing it/);
  });

  // A valid number the converter will not expand is a limit rejection, not
  // malformed input. Both used to produce the same message, which described a
  // resource refusal as a syntax error.
  it("names the reason when a valid exponent is too large to expand", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: { gstin: OWNER_GSTIN, rtnprd: "042026", docdata: docdata() },
      }).replace('"val":110', '"val":1.1E999999999'),
    );

    expect(() =>
      buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
        generatedAt: new Date("2026-08-22T12:00:00.000Z"),
      }),
    ).toThrow(/cannot be written to a spreadsheet without changing it/);
  });

  // The ITC totals a return preparer works from reached only the tidy CSV,
  // which for GSTR-2B carries no invoice rows -- so the figures a taxpayer
  // files from sat in the artifact least able to show them.
  it("states the portal's own ITC totals on a first sheet", () => {
    const entries = extractStoredZipEntries(buildWorkbook(docdata()));
    expect(sheetNames(text(entries, "xl/workbook.xml"))[0]).toBe("ITC summary");

    const { header, data } = partitionSheet(text(entries, "xl/worksheets/sheet1.xml"));
    expect(header.some((row) => row.includes(OWNER_GSTIN))).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    // A category rollup and the per-section row beneath it, labelled with the
    // sheet name that section is rendered on.
    expect(data.some((row) => row.includes("All"))).toBe(true);
    expect(data.some((row) => row.includes("B2B"))).toBe(true);
    expect(data.some((row) => row.includes("ITC available"))).toBe(true);
  });

  it("walks an ITC category this build does not know rather than dropping it", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: {
          gstin: OWNER_GSTIN,
          rtnprd: "042026",
          docdata: docdata(),
          itcsumm: { itcavl: { somefuturecategory: { igst: 5, cgst: 0, sgst: 0, cess: 0 } } },
        },
      }),
    );
    const workbook = buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
      generatedAt: new Date("2026-08-22T12:00:00.000Z"),
    });

    const { data } = partitionSheet(
      text(extractStoredZipEntries(workbook!.bytes), "xl/worksheets/sheet1.xml"),
    );
    expect(data.some((row) => row.includes("somefuturecategory"))).toBe(true);
  });

  // Reconciliation against a purchase register matches on counterparty GSTIN
  // plus document number, and Excel's VLOOKUP wants the key in the first
  // column of its range. Normalised on both halves, because a match fails on a
  // case or padding difference alone.
  it("leads each invoice row with a normalised reconciliation key", () => {
    const data = docdata();
    data.b2b[0]!.inv[0]!.inum = " inv-001 ";
    const { data: rows } = partitionSheet(
      text(extractStoredZipEntries(buildWorkbook(data)), "xl/worksheets/sheet2.xml"),
    );

    expect(rows[0]?.[0]).toBe(`${COUNTERPARTY_GSTIN}|INV-001`);
  });

  // FORM GSTR-2B carries a `GSTR-3B table` column against every summary
  // heading, so printing it reproduces the form rather than asserting a mapping
  // of ours. Which JSON key is which heading was settled by matching a captured
  // period against the portal's rendered summary.
  it("prints the GSTR-3B table the form prescribes, and none where unestablished", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: {
          gstin: OWNER_GSTIN,
          rtnprd: "042026",
          docdata: docdata(),
          itcsumm: {
            itcavl: {
              nonrevsup: { igst: 10, cgst: 0, sgst: 0, cess: 0 },
              revsup: { igst: 5, cgst: 0, sgst: 0, cess: 0 },
              imports: { igst: 7, cess: 0 },
              othersup: { igst: 3, cgst: 0, sgst: 0, cess: 0 },
            },
            itcunavl: { nonrevsup: { igst: 1, cgst: 0, sgst: 0, cess: 0 } },
          },
        },
      }),
    );
    const workbook = buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
      generatedAt: new Date("2026-08-22T12:00:00.000Z"),
    });
    const { data } = partitionSheet(
      text(extractStoredZipEntries(workbook!.bytes), "xl/worksheets/sheet1.xml"),
    );
    const tableFor = (category: string) =>
      data.find((row) => row.includes(category))?.[3] ?? "(none)";

    expect(tableFor("Supplies other than reverse charge")).toBe("4(A)(5)");
    expect(tableFor("Reverse charge supplies")).toBe("3.1(d), 4(A)(3)");
    expect(tableFor("Imports")).toBe("4(A)(1)");
    // Matched no Part A heading, so no reference is printed against it.
    const othersup = data.find((row) => row.includes("Other supplies"));
    expect(othersup?.[3]).not.toBe("4(A)(5)");
    expect(othersup?.[3]).not.toMatch(/^4\(A\)/);
  });

  // An ITC summary alone must not make a workbook. A nil period, or one holding
  // only a section this build does not render, would otherwise produce an
  // ITC-only workbook -- which suppresses the `no-records` outcome and drops the
  // tidy CSV that is the fallback for exactly that case.
  it("produces no workbook from an ITC summary with no renderable invoice rows", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: {
          gstin: OWNER_GSTIN,
          rtnprd: "042026",
          docdata: {},
          itcsumm: { itcavl: { nonrevsup: { igst: 10, cgst: 0, sgst: 0, cess: 0 } } },
        },
      }),
    );

    expect(
      buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
        generatedAt: new Date("2026-08-22T12:00:00.000Z"),
      }),
    ).toBeNull();
  });

  // A screened-out ITC key takes every total beneath it, and the CSV that used
  // to carry those figures is no longer shipped alongside. An omission nobody
  // can see would be a figure that simply vanished.
  it("counts an ITC key its own screen rejects", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: {
          gstin: OWNER_GSTIN,
          rtnprd: "042026",
          docdata: docdata(),
          itcsumm: {
            itcavl: {
              nonrevsup: { igst: 10, cgst: 0, sgst: 0, cess: 0 },
              [COUNTERPARTY_GSTIN]: { igst: 1, cgst: 0, sgst: 0, cess: 0 },
            },
          },
        },
      }),
    );
    const workbook = buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
      generatedAt: new Date("2026-08-22T12:00:00.000Z"),
    });
    const itc = text(extractStoredZipEntries(workbook!.bytes), "xl/worksheets/sheet1.xml");

    expect(itc).not.toContain(COUNTERPARTY_GSTIN);
    expect(itc).toContain("section name(s) withheld");
  });

  it("upper-cases both halves of the reconciliation key", () => {
    const data = docdata();
    data.b2b[0]!.ctin = COUNTERPARTY_GSTIN.toLowerCase();
    data.b2b[0]!.inv[0]!.inum = "inv-001";
    const { data: rows } = partitionSheet(
      text(extractStoredZipEntries(buildWorkbook(data)), "xl/worksheets/sheet2.xml"),
    );

    expect(rows[0]?.[0]).toBe(`${COUNTERPARTY_GSTIN}|INV-001`);
  });

  // The scan reads raw text because JSON.parse destroys the precision it
  // guards, but a whole-document sweep refused workbooks over values nothing
  // renders. `cpsumm` is the portal's own counterparty roll-up and reaches no
  // cell.
  it("ignores an unrepresentable value in a subtree it never renders", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: {
          gstin: OWNER_GSTIN,
          rtnprd: "042026",
          cpsumm: { b2b: [{ ctin: COUNTERPARTY_GSTIN, txval: 1 }] },
          docdata: docdata(),
        },
      }).replace('"txval":1', '"txval":1.11111111111111111E5'),
    );

    const workbook = buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
      generatedAt: new Date("2026-08-22T12:00:00.000Z"),
    });

    expect(workbook, "an unrendered subtree refused the workbook").not.toBeNull();
  });

  // Still refused where the value does become a cell. The ITC summary sheet
  // renders `itcsumm`, which it did not when the scan was written -- so the
  // scope has to name it, not merely exclude the siblings that existed then.
  it("still refuses an unrepresentable value in the ITC summary", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [planEntry("April", "april-data.json")];
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        data: {
          gstin: OWNER_GSTIN,
          rtnprd: "042026",
          docdata: docdata(),
          itcsumm: { itcavl: { nonrevsup: { igst: 1, cgst: 0, sgst: 0, cess: 0 } } },
        },
      }).replace('"igst":1,', '"igst":1.11111111111111111E5,'),
    );

    expect(() =>
      buildFiledReturnsGstr2bWorkbook(plan, [{ path: "april-data.json", bytes }], {
        generatedAt: new Date("2026-08-22T12:00:00.000Z"),
      }),
    ).toThrow(/cannot be written to a spreadsheet without changing it/);
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
  return workbook.bytes;
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
          // Every captured period carries an ITC summary, so a fixture without
          // one is not a representative response -- and the sheet built from it
          // would never be exercised.
          itcsumm: {
            itcavl: {
              nonrevsup: {
                igst: 10,
                cgst: 0,
                sgst: 0,
                cess: 0,
                b2b: { txval: 100, igst: 10, cgst: 0, sgst: 0, cess: 0 },
              },
            },
          },
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
  // The invoice sheets lead with the reconciliation match key and the summary
  // sheets lead with the period, so the boundary is either of those.
  const columnHeader = rows.findIndex((row) => row[0] === "Match key" || row[0] === "Period");
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

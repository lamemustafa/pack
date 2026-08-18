import { describe, expect, it } from "vitest";
import {
  buildFiledReturnsSummarySheet,
  FiledReturnsSummaryTooLargeError,
  FILED_RETURNS_SUMMARY_CONTEXT_PATH,
  FILED_RETURNS_SUMMARY_FORMAT_VERSION,
  FILED_RETURNS_SUMMARY_HEADERS,
  FILED_RETURNS_SUMMARY_SHEET_PATH,
  type FiledReturnsSummaryPlanEntry,
} from "../../src/connectors/gst/filed-returns-summary-sheet";
import { FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE } from "../../src/connectors/gst/filed-returns-summary-labels";
import { MAX_FILED_RETURNS_SUMMARY_ARRAY_EXPANSION_ELEMENTS } from "../../src/connectors/gst/filed-returns-summary-arrays";

describe("filed-return full-year summary sheet", () => {
  it("emits tidy numeric and text rows while moving taxpayer identity into context once", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"gstin":"00XXXXX0000X0Z0","pan":"AAAAA0000A","taxpayer_name":"Synthetic Taxpayer Name","lgnm":"Synthetic Legal Name","ret_period":"0042026","sup_details":{"osup_det":{"txval":2.038519331E7,"iamt":99999999999999.999}},"surrounding_decoy":{"leading_zero_id":"00042","empty_text":"","unknown_amount":7},"entries":[{"ignored":900},{"ignored":800}]}',
          ),
        },
      ],
    );

    const dataRows = parseCsv(new TextDecoder().decode(summary.dataBytes));
    expect(Object.keys(dataRows[0]!)).toEqual(FILED_RETURNS_SUMMARY_HEADERS);
    expect(fieldRow(dataRows, "/sup_details/osup_det/txval")).toMatchObject({
      period: "April",
      return_type: "GSTR-3B",
      artifact: "JSON",
      outcome: "parseable-json",
      field_label:
        "Table 3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted) — Taxable value",
      value_text: "",
      value_number: "20385193.31",
    });
    expect(fieldRow(dataRows, "/sup_details/osup_det/iamt")).toMatchObject({
      value_text: "",
      value_number: "99999999999999.999",
    });
    expect(fieldRow(dataRows, "/ret_period")).toMatchObject({
      field_label: "",
      value_text: "0042026",
      value_number: "",
    });
    expect(fieldRow(dataRows, "/surrounding_decoy/leading_zero_id")).toMatchObject({
      field_label: "",
      value_text: "00042",
      value_number: "",
    });
    expect(fieldRow(dataRows, "/entries")).toMatchObject({
      outcome: "array-count-not-selected",
      value_text: "",
      value_number: "2",
    });
    expect(dataRows.every(exactlyOneValueColumnForFieldRow)).toBe(true);
    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    expect(dataCsv).not.toMatch(/00XXXXX|AAAAA0000A|Synthetic (?:Legal|Taxpayer) Name/);
    expect(dataCsv).not.toMatch(/E7|'20385193\.31/);
    expect(dataCsv).toContain('/surrounding_decoy/empty_text,"",');

    const context = new TextDecoder().decode(summary.contextBytes);
    expect(context).toContain(FILED_RETURNS_SUMMARY_FORMAT_VERSION);
    expect(context).toContain(FILED_RETURNS_SUMMARY_SHEET_PATH);
    expect(context).toContain(FILED_RETURNS_SUMMARY_CONTEXT_PATH);
    expect(context.match(/00XXXXX0000X0Z0/g)).toHaveLength(1);
    expect(context.match(/AAAAA0000A/g)).toHaveLength(1);
    expect(context.match(/Synthetic Taxpayer Name/g)).toHaveLength(1);
    expect(context.match(/Synthetic Legal Name/g)).toHaveLength(1);
    expect(context).toContain("taxpayer_identity,identity,GSTIN,/gstin,00XXXXX0000X0Z0");
    expect(context).toContain("taxpayer_identity,identity,Legal name,/lgnm,Synthetic Legal Name");
    expect(context).toContain("taxpayer_identity,identity,PAN,/pan,AAAAA0000A");
    expect(context).toContain(
      "taxpayer_identity,identity,Taxpayer name,/taxpayer_name,Synthetic Taxpayer Name",
    );
    expect(summary).toMatchObject({ outcomeOnly: false, parsedPeriodCount: 1 });
  });

  it("expands a small GSTR-3B ITC array by its stable discriminator", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        jsonEntry("april-data.json", {
          itc_elg: {
            itc_avl: [
              { ty: "IMPG", iamt: 11, camt: 12, samt: 13 },
              { ty: "IMPS", iamt: 21, camt: 22, samt: 23 },
              { ty: "ISRC", iamt: 31, camt: 32, samt: 33 },
              { ty: "ISD", iamt: 41, camt: 42, samt: 43 },
              { ty: "OTH", iamt: 51, camt: 52, samt: 53 },
            ],
          },
          surrounding_decoy: { ignored: "synthetic" },
        }),
      ],
    );

    const rows = parseCsv(new TextDecoder().decode(summary.dataBytes));
    expect(fieldRow(rows, "/itc_elg/itc_avl/OTH/camt")).toMatchObject({
      outcome: "parseable-json",
      field_label: "Table 4(A)(5) All other ITC — Central tax",
      value_text: "",
      value_number: "52",
    });
    expect(rows.some((row) => row.field_path === "/itc_elg/itc_avl")).toBe(false);
  });

  it("keeps an over-ceiling eligible array as one count row with a reason", () => {
    const elements = Array.from(
      { length: MAX_FILED_RETURNS_SUMMARY_ARRAY_EXPANSION_ELEMENTS + 1 },
      (_, index) => ({ ty: `T${index}`, camt: index + 1 }),
    );
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [jsonEntry("april-data.json", { itc_elg: { itc_avl: elements } })],
    );
    const rows = parseCsv(new TextDecoder().decode(summary.dataBytes));

    expect(fieldRow(rows, "/itc_elg/itc_avl")).toMatchObject({
      outcome: "array-count-over-ceiling",
      value_number: String(MAX_FILED_RETURNS_SUMMARY_ARRAY_EXPANSION_ELEMENTS + 1),
    });
    expect(rows.some((row) => (row.field_path ?? "").startsWith("/itc_elg/itc_avl/T"))).toBe(false);
  });

  it("keeps an array without one common discriminator as a named count row", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        jsonEntry("april-data.json", {
          itc_elg: {
            itc_rev: [
              { ty: "RUL", camt: 1 },
              { pos: "02", camt: 2 },
            ],
          },
        }),
      ],
    );
    const rows = parseCsv(new TextDecoder().decode(summary.dataBytes));

    expect(fieldRow(rows, "/itc_elg/itc_rev")).toMatchObject({
      outcome: "array-count-no-common-discriminator",
      value_number: "2",
    });
  });

  it("keeps duplicate discriminator values as a named count row", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        jsonEntry("april-data.json", {
          itc_elg: {
            itc_inelg: [
              { ty: "OTH", camt: 1 },
              { ty: "OTH", camt: 2 },
            ],
          },
        }),
      ],
    );
    const rows = parseCsv(new TextDecoder().decode(summary.dataBytes));

    expect(fieldRow(rows, "/itc_elg/itc_inelg")).toMatchObject({
      outcome: "array-count-duplicate-discriminator",
      value_number: "2",
    });
  });

  it("expands a small place-of-supply array by its pos discriminator", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        jsonEntry("april-data.json", {
          inter_sup: {
            unreg_details: [
              { pos: "01", txval: 101, iamt: 11 },
              { pos: "02", txval: 202, iamt: 22 },
            ],
          },
        }),
      ],
    );
    const rows = parseCsv(new TextDecoder().decode(summary.dataBytes));

    expect(fieldRow(rows, "/inter_sup/unreg_details/02/txval")).toMatchObject({
      outcome: "parseable-json",
      value_number: "202",
    });
    expect(rows.some((row) => row.field_path === "/inter_sup/unreg_details")).toBe(false);
  });

  it("keeps the fixed column set across return types and different field sets", () => {
    const gstr1 = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-1")],
      [jsonEntry("april-data.json", { alpha: "0001", decoy: { only_gstr1: 12 } })],
    );
    const gstr2b = buildFiledReturnsSummarySheet(
      [jsonPlan("May", "may-data.json", "GSTR-2B")],
      [jsonEntry("may-data.json", { beta: true, different_decoy: [1, 2, 3] })],
    );

    expect(firstLine(gstr1.dataBytes)).toBe(FILED_RETURNS_SUMMARY_HEADERS.join(","));
    expect(firstLine(gstr2b.dataBytes)).toBe(FILED_RETURNS_SUMMARY_HEADERS.join(","));
    expect(new TextDecoder().decode(gstr1.dataBytes)).not.toContain("different_decoy");
    expect(new TextDecoder().decode(gstr2b.dataBytes)).not.toContain("only_gstr1");
  });

  it("records unavailable and non-JSON outcomes without fabricating zeroes", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [
      {
        artifactType: "PDF",
        entryNames: ["april-summary.pdf"],
        financialYear: "2026-27",
        outcomeCategory: "staged",
        period: "April",
        returnType: "GSTR-2B",
      },
      {
        artifactType: "JSON",
        entryNames: [],
        financialYear: "2026-27",
        outcomeCategory: "artifact-unavailable",
        period: "April",
        returnType: "GSTR-2B",
      },
    ];

    const summary = buildFiledReturnsSummarySheet(plan, []);
    const rows = parseCsv(new TextDecoder().decode(summary.dataBytes));

    expect(rows).toEqual([
      expect.objectContaining({
        period: "April",
        artifact: "PDF",
        outcome: "non-json-artifact",
        field_path: "pack:outcome",
        value_text: "",
        value_number: "",
      }),
      expect.objectContaining({
        period: "April",
        artifact: "JSON",
        outcome: "artifact-unavailable",
        field_path: "pack:outcome",
        value_text: "",
        value_number: "",
      }),
    ]);
    expect(summary).toMatchObject({ outcomeOnly: true, parsedPeriodCount: 0, rowCount: 2 });
  });

  it("fails summary generation when invariant taxpayer identity conflicts", () => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [
          jsonPlan("April", "april-data.json", "GSTR-3B"),
          jsonPlan("May", "may-data.json", "GSTR-3B"),
        ],
        [
          jsonEntry("april-data.json", { gstin: "00XXXXX0000X0Z0", amount: 1 }),
          jsonEntry("may-data.json", { gstin: "00YYYYY0000Y0Z0", amount: 2 }),
        ],
      ),
    ).toThrow("Inconsistent taxpayer identity");
  });

  it.each([
    "cookie",
    "access_token",
    "authorization",
    "auth_header",
    "authentication",
    "authn",
    "session_id",
    "sid",
    "otp",
    "captcha",
    "password",
    "passcode",
    "credential",
    "credentials",
    "api_key",
    "jwt",
    "bearer",
    "x_auth",
  ])("fails summary generation when portal JSON contains forbidden %s material", (field) => {
    const secret = "synthetic-sensitive-value";
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-2B")],
        [jsonEntry("april-data.json", { amount: 1, [field]: secret })],
      ),
    ).toThrow("credential or session field");
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-2B")],
        [jsonEntry("april-data.json", { amount: 1, [field]: secret })],
      ),
    ).not.toThrow(secret);
  });

  it("fails summary generation when a forbidden field is an ancestor container", () => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-2B")],
        [jsonEntry("april-data.json", { amount: 1, session: { id: "synthetic-sensitive" } })],
      ),
    ).toThrow("credential or session field");
  });

  it("bounds retained JSON Pointer paths before descending into wide nested keys", () => {
    const wideKeys = Array.from({ length: 12 }, (_, index) => `${index}-${"k".repeat(180)}`);
    const json = `${wideKeys.map((key) => `{"${key}":`).join("")}"leaf"${"}".repeat(wideKeys.length)}`;

    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-2B")],
        [{ path: "april-data.json", bytes: new TextEncoder().encode(json) }],
        1_024,
      ),
    ).toThrow(FiledReturnsSummaryTooLargeError);
  });

  it("requires provenance for every populated return-type label", () => {
    for (const labels of Object.values(FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE)) {
      for (const entry of Object.values(labels)) {
        expect(entry.label.length).toBeGreaterThan(0);
        expect([
          "official-offline-utility",
          "portal-pdf-value-cross-check-two-periods",
          "form-vocabulary-and-row-order",
        ]).toContain(entry.provenance.evidence);
        expect(entry.provenance.officialSource).toContain("GST Portal");
        expect(entry.provenance.officialSourceLocation.length).toBeGreaterThan(0);
        expect(entry.provenance.reviewedOn).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
      }
    }
    expect(
      Object.keys(FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE["GSTR-3B"]).length,
    ).toBeGreaterThan(0);
    expect(FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE["GSTR-1"]).toEqual({});
    expect(FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE["GSTR-2B"]).toEqual({});
    expect(
      FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE["GSTR-3B"]["/itc_elg/itc_avl/OTH/camt"]
        ?.provenance.evidence,
    ).toBe("portal-pdf-value-cross-check-two-periods");
    expect(
      FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE["GSTR-3B"]["/itc_elg/itc_avl/IMPG/camt"]
        ?.provenance.evidence,
    ).toBe("form-vocabulary-and-row-order");
    expect(
      FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE["GSTR-3B"]["/sup_details/osup_zero/txval"]
        ?.provenance.evidence,
    ).toBe("official-offline-utility");
  });
});

function jsonPlan(
  period: "April" | "May",
  entryName: string,
  returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B",
): FiledReturnsSummaryPlanEntry {
  return {
    artifactType: "JSON",
    entryNames: [entryName],
    financialYear: "2026-27",
    outcomeCategory: "staged",
    period,
    returnType,
  };
}

function jsonEntry(path: string, value: unknown) {
  return { path, bytes: new TextEncoder().encode(JSON.stringify(value)) };
}

function firstLine(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).split("\n")[0]!;
}

function fieldRow(rows: Record<string, string>[], path: string): Record<string, string> {
  const row = rows.find((candidate) => candidate.field_path === path);
  if (!row) throw new Error(`missing synthetic field row ${path}`);
  return row;
}

function exactlyOneValueColumnForFieldRow(row: Record<string, string>): boolean {
  if (row.field_path === "pack:outcome") return true;
  if (row.field_path === "/surrounding_decoy/empty_text") return true;
  return Number(row.value_text !== "") + Number(row.value_number !== "") === 1;
}

function parseCsv(input: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(cell);
      cell = "";
    } else if (character === "\n") {
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  const [headers, ...rows] = records;
  if (!headers) return [];
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

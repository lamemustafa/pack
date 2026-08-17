import { describe, expect, it } from "vitest";
import {
  buildFiledReturnsSummarySheet,
  FiledReturnsSummaryTooLargeError,
  FILED_RETURNS_SUMMARY_ARRAY_RULE,
  FILED_RETURNS_SUMMARY_NUMBER_RULE,
  FILED_RETURNS_SUMMARY_TEXT_RULE,
  type FiledReturnsSummaryPlanEntry,
} from "../../src/connectors/gst/filed-returns-summary-sheet";

describe("filed-return full-year summary sheet", () => {
  it("keeps portal paths, counts nested arrays, and orders the union of leaves deterministically", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("May", "may-data.json"), jsonPlan("April", "april-data.json")],
      [
        jsonEntry("may-data.json", {
          status: 1,
          data: {
            rtnprd: "052026",
            surrounding_decoy: { z: "portal-may", a: 20 },
            entries: [{ value: 999 }, { value: 111 }],
            nullable: null,
          },
          chksum: "synthetic-may-checksum",
        }),
        jsonEntry("april-data.json", {
          status: 1,
          data: {
            rtnprd: "042026",
            surrounding_decoy: { z: "portal-april" },
            entries: [{ value: 123 }],
            own_key: 10,
          },
          chksum: "synthetic-april-checksum",
        }),
      ],
    );

    const csv = new TextDecoder().decode(summary.bytes);
    const [header, april, may] = csv.trimEnd().split("\n");
    expect(header).toBe(
      "pack:format,pack:array_rule,pack:number_rule,pack:text_rule,pack:period,pack:return_type,pack:artifact,pack:outcome_category,json:/chksum,json:/data/entries,json:/data/nullable,json:/data/own_key,json:/data/rtnprd,json:/data/surrounding_decoy/a,json:/data/surrounding_decoy/z,json:/status",
    );
    expect(april).toContain(
      `portal-json-flat-v1,${FILED_RETURNS_SUMMARY_ARRAY_RULE},${FILED_RETURNS_SUMMARY_NUMBER_RULE},${FILED_RETURNS_SUMMARY_TEXT_RULE},April,GSTR-2B,JSON,parseable-json`,
    );
    expect(april).toContain(",synthetic-april-checksum,1,,'10,042026,,portal-april,'1");
    expect(may).toContain(",synthetic-may-checksum,2,null,,052026,'20,portal-may,'1");
    expect(csv).not.toContain("Total taxable value");
    expect(csv).not.toContain("999");
    expect(csv).not.toContain("111");
    expect(summary).toMatchObject({ outcomeOnly: false, parsedPeriodCount: 2, rowCount: 2 });
  });

  it("records unavailable and non-JSON outcomes without fabricating zeroes", () => {
    const plan: FiledReturnsSummaryPlanEntry[] = [
      {
        artifactType: "PDF",
        entryNames: ["april-summary.pdf"],
        outcomeCategory: "staged",
        period: "April",
        returnType: "GSTR-2B",
      },
      {
        artifactType: "JSON",
        entryNames: [],
        outcomeCategory: "artifact-unavailable",
        period: "April",
        returnType: "GSTR-2B",
      },
    ];

    const summary = buildFiledReturnsSummarySheet(plan, []);
    const csv = new TextDecoder().decode(summary.bytes);

    expect(csv).toContain("April,GSTR-2B,PDF,non-json-artifact");
    expect(csv).toContain("April,GSTR-2B,JSON,artifact-unavailable");
    expect(csv).not.toMatch(/,0(?:,|\n)/);
    expect(summary).toMatchObject({ outcomeOnly: true, parsedPeriodCount: 0, rowCount: 2 });
  });

  it("preserves integer, fractional, and exponent number tokens without JS rounding", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"rtnprd":"042026","integer":9007199254740993,"fraction":99999999999999.999,"small":0.10000000000000001,"exponent":1.2300e+40},"chksum":"synthetic"}',
          ),
        },
      ],
    );
    const csv = new TextDecoder().decode(summary.bytes);

    expect(csv).toContain("April,GSTR-2B,JSON,parseable-json");
    expect(csv).not.toContain("9007199254740992");
    expect(csv).not.toContain("'100000000000000,");
    expect(csv).toContain("'9007199254740993");
    expect(csv).toContain("'99999999999999.999");
    expect(csv).toContain("'0.10000000000000001");
    expect(csv).toContain("'1.2300e+40");
    expect(summary).toMatchObject({ outcomeOnly: false, parsedPeriodCount: 1, rowCount: 1 });
  });

  it("bounds retained JSON Pointer paths before descending into wide nested keys", () => {
    const wideKeys = Array.from({ length: 12 }, (_, index) => `${index}-${"k".repeat(180)}`);
    const json = `${wideKeys.map((key) => `{"${key}":`).join("")}"leaf"${"}".repeat(wideKeys.length)}`;

    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json")],
        [{ path: "april-data.json", bytes: new TextEncoder().encode(json) }],
        1_024,
      ),
    ).toThrow(FiledReturnsSummaryTooLargeError);
  });
});

function jsonPlan(period: "April" | "May", entryName: string): FiledReturnsSummaryPlanEntry {
  return {
    artifactType: "JSON",
    entryNames: [entryName],
    outcomeCategory: "staged",
    period,
    returnType: "GSTR-2B",
  };
}

function jsonEntry(path: string, value: unknown) {
  return { path, bytes: new TextEncoder().encode(JSON.stringify(value)) };
}

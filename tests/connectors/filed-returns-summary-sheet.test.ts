import { describe, expect, it } from "vitest";
import {
  buildFiledReturnsSummarySheet,
  FiledReturnsSummaryIdentityConflictError,
  FiledReturnsSummaryTooLargeError,
  MAX_FILED_RETURNS_SUMMARY_ARRAY_EXPANSION_ELEMENTS,
  FILED_RETURNS_SUMMARY_HEADERS,
  FiledReturnsSummaryUncanonicalIdentityError,
  type FiledReturnsSummaryPlanEntry,
} from "../../src/connectors/gst/filed-returns-summary-sheet";
import {
  FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE,
  filedReturnsSummaryFieldLabel,
} from "../../src/connectors/gst/filed-returns-summary-labels";
import type { FiledReturnsMonth } from "../../src/connectors/gst/filed-returns-scope";

// Assembled at runtime rather than written as a literal: a JWT-shaped string in
// source is flagged by secret scanning even when its payload is synthetic, and a
// scanner finding cannot be distinguished from a real one by looking at it. The
// value the guard sees is identical.
const base64Url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const syntheticJwt = [
  base64Url({ alg: "HS256" }),
  base64Url({ sub: "synthetic" }),
  Buffer.from("synthetic-signature").toString("base64url"),
].join(".");

describe("filed-return full-year summary sheet", () => {
  it("emits the single planned financial year in every CSV row", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [jsonEntry("april-data.json", "GSTR-3B", { sup_details: { osup_det: { txval: 12.5 } } })],
    );

    expect(new TextDecoder().decode(summary.dataBytes)).toBe(
      "financial_year,period,return_type,artifact,outcome,field_label,field_path,value_text,value_number\n" +
        "2026-27,April,GSTR-3B,JSON,parseable-json,,/ret_period,042026,\n" +
        '2026-27,April,GSTR-3B,JSON,parseable-json,"Table 3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted) — Taxable value",/sup_details/osup_det/txval,,12.5\n',
    );
  });

  it("refuses a mixed-year plan before it can form a CSV", () => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [
          jsonPlan("April", "april-data.json", "GSTR-3B"),
          { ...jsonPlan("May", "may-data.json", "GSTR-3B"), financialYear: "2027-28" },
        ],
        [],
      ),
    ).toThrow("Filed-return summary plan must have one financial year.");
  });

  it("refuses an identity-shaped array discriminator instead of embedding it in a path", () => {
    const build = (ty: string) =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-3B")],
        [
          {
            path: "april-data.json",
            bytes: new TextEncoder().encode(
              `{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","itc_elg":{"itc_avl":[{"ty":"${ty}","iamt":5}]}}}}`,
            ),
          },
        ],
      );

    const safe = new TextDecoder().decode(build("IMPG").dataBytes);
    expect(safe).toContain("/itc_elg/itc_avl/IMPG/iamt");

    // Anything outside the key's own shape is refused: expansion would copy it
    // into the path and drop its own leaf, where field-name redaction cannot see
    // it. A six-digit code is the credential case; PAN-shaped is the identity one.
    for (const unsafeValue of ["AAAAA0000A", "123456"]) {
      const unsafe = new TextDecoder().decode(build(unsafeValue).dataBytes);
      expect(unsafe).not.toContain(unsafeValue);
      expect(unsafe).toContain("array-count-unsafe-discriminator");
    }
  });

  it("withholds the taxpayer's own identifier under an unrecognised alias, but keeps a counterparty one", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","registration_number":"27abcde1234f1z0","ctin":"29ZZZZZ9999Z9ZW","sup_details":{"osup_det":{"txval":1}}}}}',
          ),
        },
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    // Same identifier as the canonical gstin, under a field name the alias
    // registry does not know, and in different casing.
    expect(dataCsv).not.toContain("27abcde1234f1z0");
    expect(dataCsv).not.toContain("27ABCDE1234F1Z0");
    // A counterparty identifier is business data the summary exists to report.
    expect(dataCsv).toContain("29ZZZZZ9999Z9ZW");
  });

  it("withholds a filing identity repeated under an unrecognised alias", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"lglnm":"Synthetic Legal Name","arn":"SYNTHETIC-ARN-APRIL","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","reference_number":"SYNTHETIC-ARN-APRIL","sup_details":{"osup_det":{"txval":1}}}}}',
          ),
        },
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    // The canonical arn leaf is already withheld by path; the duplicate must be
    // too, or redaction depends on which name the portal happened to use. The
    // value still reaches the context rows, so it is withheld from the data
    // rows rather than lost.
    expect(dataCsv).not.toContain("SYNTHETIC-ARN-APRIL");
    expect(summary.contextRows.map((row) => row.valueText)).toContain("SYNTHETIC-ARN-APRIL");
    expect(dataCsv).toContain("/sup_details/osup_det/txval");
  });

  it("withholds an identity one period names canonically from every other period", () => {
    const summary = buildFiledReturnsSummarySheet(
      [
        jsonPlan("April", "april-data.json", "GSTR-3B"),
        jsonPlan("May", "may-data.json", "GSTR-3B"),
      ],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"lglnm":"Synthetic Legal Name","trdnm":"Synthetic Trade Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","sup_details":{"osup_det":{"txval":1}}}}}',
          ),
        },
        {
          path: "may-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"052026","registration_name":"Synthetic Trade Name","by_name":{"Synthetic Trade Name":{"amount":7}},"sup_details":{"osup_det":{"txval":2}}}}}',
          ),
        },
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    // Identity belongs to the taxpayer, not to one month. April names the trade
    // name canonically; May repeats it only under an unrecognised alias and as
    // an object key, where nothing in May alone could recognise it.
    expect(dataCsv).not.toContain("Synthetic Trade Name");
    // It still reaches the context rows once, so it is withheld rather than lost.
    expect(summary.contextRows.map((row) => row.valueText)).toContain("Synthetic Trade Name");
    // Nothing legitimate is dropped with it.
    expect(dataCsv).toContain("/sup_details/osup_det/txval");
    expect(
      parseCsv(dataCsv).filter((row) => row.field_path === "/sup_details/osup_det/txval"),
    ).toHaveLength(2);
  });

  it("rejects conflicting taxpayer identities with a reason that names the conflict", () => {
    const build = () =>
      buildFiledReturnsSummarySheet(
        [
          jsonPlan("April", "april-data.json", "GSTR-3B"),
          jsonPlan("May", "may-data.json", "GSTR-3B"),
        ],
        [
          {
            path: "april-data.json",
            bytes: new TextEncoder().encode(
              '{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","sup_details":{"osup_det":{"txval":1}}}}}',
            ),
          },
          {
            path: "may-data.json",
            bytes: new TextEncoder().encode(
              '{"status":1,"data":{"lglnm":"Synthetic Other Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"052026","sup_details":{"osup_det":{"txval":2}}}}}',
            ),
          },
        ],
      );

    expect(build).toThrow(FiledReturnsSummaryIdentityConflictError);
    let message = "";
    try {
      build();
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    // The rejection names its own reason and what the user can do, and carries
    // no portal value, no identity, and no path from the document.
    expect(message).toContain("conflict");
    expect(message).toContain("GST Portal");
    expect(message).not.toContain("Synthetic");
    expect(message).not.toContain("lglnm");
    expect(message).not.toContain("/");
  });

  it("withholds a JWT under a benign path but keeps a long invoice reference", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            JSON.stringify({
              status: 1,
              data: {
                lglnm: "Synthetic Legal Name",
                r3b: {
                  gstin: "27ABCDE1234F1Z0",
                  ret_period: "042026",
                  metadata: { value: syntheticJwt },
                  irn: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                  sup_details: { osup_det: { txval: 1 } },
                },
              },
            }),
          ),
        },
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    // The field name is benign, so only the value's shape can catch it.
    expect(dataCsv).not.toContain(syntheticJwt);
    // A 64-character invoice reference is legitimate data, not a credential.
    expect(dataCsv).toContain("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });

  it("withholds a leaf whose object key is the taxpayer's own name", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","by_name":{"Synthetic Legal Name":{"amount":7}},"sup_details":{"osup_det":{"txval":1}}}}}',
          ),
        },
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    // A legal name has no shape to match on, so only the document's own
    // identity values can catch it.
    expect(dataCsv).not.toContain("Synthetic Legal Name");
    expect(dataCsv).toContain("/sup_details/osup_det/txval");
  });

  it("withholds a leaf whose object key is itself identity-shaped", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","by_party":{"AAAAA0000A":{"amount":7}},"sup_details":{"osup_det":{"txval":1}}}}}',
          ),
        },
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    // The flattener copies an object key into the path verbatim, and alias-name
    // redaction only recognises field names.
    expect(dataCsv).not.toContain("AAAAA0000A");
    expect(dataCsv).toContain("/sup_details/osup_det/txval");
  });

  it("accepts a valid GSTIN whose check character is lower case", () => {
    // 27ABCDE1000F1ZC is checksum-valid and its check character is alphabetic,
    // so casing is observable here in a way a digit check character hides.
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1000F1Zc","ret_period":"042026","sup_details":{"osup_det":{"txval":1}}}}}',
          ),
        },
      ],
    );

    // Rejecting it would fail the whole summary for an identifier the portal
    // considers valid.
    expect(new TextDecoder().decode(summary.dataBytes)).toContain("/sup_details/osup_det/txval");
  });

  it("withholds a compound identity alias split across path segments", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"lglnm":"Synthetic Legal Name","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","taxpayer":{"name":"Synthetic Split Name"},"legal":{"name":"Synthetic Split Legal"},"sup_details":{"osup_det":{"txval":1}}}}}',
          ),
        },
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    // The registry knows `taxpayername` and `legalname` as single words; nested
    // under a container neither segment matches alone.
    expect(dataCsv).not.toContain("Synthetic Split Name");
    expect(dataCsv).not.toContain("Synthetic Split Legal");
    // A real mapped value alongside them is still emitted, so the broadened
    // redaction has not swallowed legitimate data.
    expect(dataCsv).toContain("/sup_details/osup_det/txval");
  });

  it("emits tidy numeric and text rows while moving taxpayer identity into context once", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        {
          path: "april-data.json",
          bytes: new TextEncoder().encode(
            '{"status":1,"data":{"pan":"AAAAA0000A","taxpayer_name":"Synthetic Taxpayer Name","lglnm":"Synthetic Legal Name","trdnm":"Synthetic Trade Name","arn":"SYNTHETIC-ARN-APRIL","arnDt":"2026-05-01","authSig":"Synthetic Signatory","desig":"Synthetic Designation","r3b":{"gstin":"27ABCDE1234F1Z0","ret_period":"042026","sup_details":{"osup_det":{"txval":2.038519331E7,"iamt":99999999999999.999}},"surrounding_decoy":{"leading_zero_id":"00042","empty_text":"","unknown_amount":7},"entries":[{"ignored":900},{"ignored":800}]}},"response_decoy":"synthetic"}',
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
      value_text: "042026",
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
    for (const identityValue of [
      "27ABCDE1234F1Z0",
      "AAAAA0000A",
      "Synthetic Taxpayer Name",
      "Synthetic Legal Name",
      "Synthetic Trade Name",
      "SYNTHETIC-ARN-APRIL",
      "2026-05-01",
      "Synthetic Signatory",
      "Synthetic Designation",
    ]) {
      expect(dataCsv).not.toContain(identityValue);
    }
    expect(dataCsv).not.toMatch(/E7|'20385193\.31/);
    expect(dataCsv).toContain('/surrounding_decoy/empty_text,"",');

    const context = contextText(summary.contextRows);
    expect(context.match(/27ABCDE1234F1Z0/g)).toHaveLength(1);
    expect(context.match(/AAAAA0000A/g)).toHaveLength(1);
    expect(context.match(/Synthetic Taxpayer Name/g)).toHaveLength(1);
    expect(context.match(/Synthetic Legal Name/g)).toHaveLength(1);
    expect(context.match(/Synthetic Trade Name/g)).toHaveLength(1);
    expect(context.match(/SYNTHETIC-ARN-APRIL/g)).toHaveLength(1);
    expect(context.match(/2026-05-01/g)).toHaveLength(1);
    expect(context.match(/Synthetic Signatory/g)).toHaveLength(1);
    expect(context.match(/Synthetic Designation/g)).toHaveLength(1);
    expect(context).toContain("taxpayer_identity,identity,GSTIN,/data/r3b/gstin,27ABCDE1234F1Z0");
    expect(context).toContain(
      "taxpayer_identity,identity,Legal name,/data/lglnm,Synthetic Legal Name",
    );
    expect(context).toContain("taxpayer_identity,identity,PAN,/data/pan,AAAAA0000A");
    expect(context).toContain(
      "taxpayer_identity,identity,Trade name,/data/trdnm,Synthetic Trade Name",
    );
    expect(context).toContain(
      "taxpayer_identity,identity,Taxpayer name,/data/taxpayer_name,Synthetic Taxpayer Name",
    );
    expect(context).toContain(
      "taxpayer_identity,identity,Signatory,/data/authSig,Synthetic Signatory",
    );
    expect(context).toContain(
      "taxpayer_identity,identity,Designation,/data/desig,Synthetic Designation",
    );
    expect(context).toContain("return_identity,GSTR-3B:April,ARN,/data/arn,SYNTHETIC-ARN-APRIL");
    expect(context).toContain("return_identity,GSTR-3B:April,ARN date,/data/arnDt,2026-05-01");
    expect(summary).toMatchObject({ outcomeOnly: false, parsedPeriodCount: 1 });
  });

  it("keeps period-specific filing identity in context without treating it as invariant", () => {
    const summary = buildFiledReturnsSummarySheet(
      [
        jsonPlan("April", "april-data.json", "GSTR-3B"),
        jsonPlan("May", "may-data.json", "GSTR-3B"),
      ],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            arn: "SYNTHETIC-ARN-APRIL",
            arnDt: "2026-05-01",
            r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 },
          },
        }),
        rawJsonEntry("may-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            arn: "SYNTHETIC-ARN-MAY",
            arnDt: "2026-06-01",
            r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "052026", amount: 2 },
          },
        }),
      ],
    );

    const data = new TextDecoder().decode(summary.dataBytes);
    expect(data).not.toContain("SYNTHETIC-ARN");
    const context = contextText(summary.contextRows);
    expect(context).toContain("return_identity,GSTR-3B:April,ARN,/data/arn,SYNTHETIC-ARN-APRIL");
    expect(context).toContain("return_identity,GSTR-3B:May,ARN,/data/arn,SYNTHETIC-ARN-MAY");
    expect(context).toContain("return_identity,GSTR-3B:April,ARN date,/data/arnDt,2026-05-01");
    expect(context).toContain("return_identity,GSTR-3B:May,ARN date,/data/arnDt,2026-06-01");
    expect(context.match(/Synthetic Legal Name/g)).toHaveLength(1);
  });

  it("moves the captured authSig signatory field out of data and into context once", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            authSig: "Synthetic Authorized Signatory",
            r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 },
          },
        }),
      ],
    );

    const data = new TextDecoder().decode(summary.dataBytes);
    expect(data).not.toContain("Synthetic Authorized Signatory");
    const context = contextText(summary.contextRows);
    expect(context.match(/Synthetic Authorized Signatory/g)).toHaveLength(1);
    expect(context).toContain(
      "taxpayer_identity,identity,Signatory,/data/authSig,Synthetic Authorized Signatory",
    );
  });

  it("classifies identity in every decoded JSON Pointer segment", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        jsonEntry("april-data.json", "GSTR-2B", {
          amount: 1,
          gstin: { status: "Synthetic Non-Identity Status", value: "27ABCDE1234F1Z0" },
          "legal/name": { value: "Synthetic Nested Legal Name" },
        }),
      ],
    );

    const data = new TextDecoder().decode(summary.dataBytes);
    expect(data).not.toContain("27ABCDE1234F1Z0");
    expect(data).not.toContain("Synthetic Nested Legal Name");
    expect(data).not.toContain("Synthetic Non-Identity Status");
    expect(data).not.toContain("/gstin/value");
    expect(data).not.toContain("/legal~1name/value");
    const context = contextText(summary.contextRows);
    expect(context).toContain("taxpayer_identity,identity,GSTIN,/data/gstin/value,27ABCDE1234F1Z0");
    expect(context).toContain(
      "taxpayer_identity,identity,Legal name,/data/legal~1name/value,Synthetic Nested Legal Name",
    );
    expect(context).not.toContain("Synthetic Non-Identity Status");
  });

  it("scopes GSTR-2B trade names to the return owner instead of supplier records", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            trdnm: "Synthetic Owner Trade Name",
            docdata: {
              b2b: [
                { ctin: "29ZZZZZ9999Z9ZW", trdnm: "Synthetic Supplier One" },
                { ctin: "33YYYYY8888Y1ZU", trdnm: "Synthetic Supplier Two" },
              ],
            },
            supplier_display_name: "Synthetic Supplier One",
          },
        }),
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    expect(contextText(summary.contextRows)).toContain(
      "taxpayer_identity,identity,Trade name,/data/trdnm,Synthetic Owner Trade Name",
    );
    expect(dataCsv).not.toContain("Synthetic Owner Trade Name");
    // A supplier's name is not an own-identity value. The same string on an
    // unrecognised leaf must remain reportable rather than being redacted by
    // value after the supplier record was seen.
    expect(dataCsv).toContain("Synthetic Supplier One");
    expect(summary).toMatchObject({ outcomeOnly: false, parsedPeriodCount: 1 });
  });

  it("does not let a slash inside a key vouch for a different record", () => {
    // Joining decoded segments with "/" lost the boundary: `/data/supplier~1x`
    // and `/data/supplier/x` flattened to the same key, so a valid ctin in one
    // record released a trade name in an unrelated one.
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            "supplier/x": { ctin: "29ZZZZZ9999Z9ZW", trdnm: "Synthetic Real Supplier" },
            supplier: { x: { trdnm: "Synthetic Owner Trade Name" } },
          },
        }),
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);

    expect(dataCsv).toContain("Synthetic Real Supplier");
    expect(dataCsv).not.toContain("Synthetic Owner Trade Name");
  });

  it("rejects a ctin matching an owner GSTIN that a different period established", () => {
    // The owner is a property of the summary, not of whichever document names
    // them. Scoping the comparison per entry left a period that omits the owner
    // GSTIN accepting it as someone else's.
    const summary = buildFiledReturnsSummarySheet(
      [
        jsonPlan("April", "april-data.json", "GSTR-2B"),
        jsonPlan("May", "may-data.json", "GSTR-2B"),
      ],
      [
        rawJsonEntry("april-data.json", {
          data: { rtnprd: "042026", gstin: "27ABCDE1234F1Z0", amount: 1 },
        }),
        rawJsonEntry("may-data.json", {
          data: {
            rtnprd: "052026",
            wrapper: { ctin: "27ABCDE1234F1Z0", trdnm: "Synthetic Owner Trade Name" },
            amount: 2,
          },
        }),
      ],
    );

    expect(new TextDecoder().decode(summary.dataBytes)).not.toContain("Synthetic Owner Trade Name");
  });

  it("does not exempt a value nested under a counterparty trade name", () => {
    // The carve-out vouches for the supplier's own name, not for whatever sits
    // underneath it. An object-shaped trdnm gave every descendant the record
    // prefix, so a nested owner trade name inherited the exemption.
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            supplier: {
              ctin: "29ZZZZZ9999Z9ZW",
              trdnm: { copy: "Synthetic Owner Trade Name" },
            },
          },
        }),
      ],
    );

    expect(new TextDecoder().decode(summary.dataBytes)).not.toContain("Synthetic Owner Trade Name");
  });

  it("does not accept the owner's own GSTIN as counterparty evidence", () => {
    // A valid checksum proves the value is a GSTIN, not that it belongs to
    // someone else. A wrapper repeating the owner's GSTIN is the owner's record.
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            gstin: "27ABCDE1234F1Z0",
            wrapper: { ctin: "27ABCDE1234F1Z0", trdnm: "Synthetic Owner Trade Name" },
          },
        }),
      ],
    );

    expect(new TextDecoder().decode(summary.dataBytes)).not.toContain("Synthetic Owner Trade Name");
  });

  it("does not let one sibling's counterparty evidence vouch for another", () => {
    // Canonical segments fold punctuation, so `supplier-one` and `supplier_one`
    // were the same record. A valid ctin under the first then released whatever
    // sat under the second, which had proved nothing.
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            "supplier-one": { ctin: "29ZZZZZ9999Z9ZW", trdnm: "Synthetic Real Supplier" },
            supplier_one: { trdnm: "Synthetic Owner Trade Name" },
          },
        }),
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);

    expect(dataCsv).toContain("Synthetic Real Supplier");
    expect(dataCsv).not.toContain("Synthetic Owner Trade Name");
  });

  it("does not release an owner trade name on a decoy counterparty identifier", () => {
    // A field NAMED ctin was treated as counterparty evidence regardless of its
    // value, so malformed or decoy portal data could mark a wrapper as a
    // supplier record and release the owner's own trade name beside it.
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            wrapper: { ctin: "unknown", trdnm: "Synthetic Owner Trade Name" },
            amount: 1,
          },
        }),
      ],
    );

    expect(new TextDecoder().decode(summary.dataBytes)).not.toContain("Synthetic Owner Trade Name");
  });

  it("keeps identity metadata out of cross-document value redaction", () => {
    // An object-shaped identity carries metadata beside the identifier. Seeding
    // redaction from every descendant string made an unrelated reportable leaf
    // sharing that text vanish in every period.
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            gstin: { value: "27ABCDE1234F1Z0", status: "Active" },
            filing_status: "Active",
            amount: 1,
          },
        }),
      ],
    );

    expect(new TextDecoder().decode(summary.dataBytes)).toContain("Active");
  });

  it("withholds an owner trade name carried by a split alias", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            trade: { name: "Synthetic Split Owner Trade Name" },
            owner_name_copy: "Synthetic Split Owner Trade Name",
            amount: 1,
          },
        }),
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    expect(contextText(summary.contextRows)).toContain(
      "taxpayer_identity,identity,Trade name,/data/trade/name,Synthetic Split Owner Trade Name",
    );
    expect(dataCsv).not.toContain("Synthetic Split Owner Trade Name");
    expect(dataCsv).toContain("/amount");
  });

  it("withholds a GSTR-3B owner trade name inside the return envelope", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            r3b: {
              gstin: "27ABCDE1234F1Z0",
              ret_period: "042026",
              trdnm: "Synthetic Envelope Owner Trade Name",
              sup_details: { osup_det: { txval: 1 } },
            },
          },
        }),
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    expect(contextText(summary.contextRows)).toContain(
      "taxpayer_identity,identity,Trade name,/data/r3b/trdnm,Synthetic Envelope Owner Trade Name",
    );
    expect(dataCsv).not.toContain("Synthetic Envelope Owner Trade Name");
  });

  it("withholds a GSTR-2B owner trade name under a wrapper", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            hdr: { trdnm: "Synthetic Wrapped Owner Trade Name" },
            amount: 1,
          },
        }),
      ],
    );

    expect(new TextDecoder().decode(summary.dataBytes)).not.toContain(
      "Synthetic Wrapped Owner Trade Name",
    );
  });

  it("withholds a GSTR-2B owner trade name under a deeper wrapper", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            a: { b: { trdnm: "Synthetic Deep Owner Trade Name" } },
            amount: 1,
          },
        }),
      ],
    );

    expect(new TextDecoder().decode(summary.dataBytes)).not.toContain(
      "Synthetic Deep Owner Trade Name",
    );
  });

  it("keeps a GSTR-2B supplier trade name with sibling counterparty evidence", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            supplier: {
              ctin: "29ZZZZZ9999Z9ZW",
              trdnm: "Synthetic Proven Supplier Trade Name",
            },
          },
        }),
      ],
    );

    expect(new TextDecoder().decode(summary.dataBytes)).toContain(
      "Synthetic Proven Supplier Trade Name",
    );
  });

  it("keeps differing supplier trade names without an identity conflict", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            supplier_one: {
              ctin: "29ZZZZZ9999Z9ZW",
              trdnm: "Synthetic Proven Supplier One",
            },
            supplier_two: {
              ctin: "33YYYYY8888Y1ZU",
              trdnm: "Synthetic Proven Supplier Two",
            },
          },
        }),
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    expect(dataCsv).toContain("Synthetic Proven Supplier One");
    expect(dataCsv).toContain("Synthetic Proven Supplier Two");
  });

  it("withholds trade names whose sibling counterparty identifier is blank or non-text", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            blank_counterparty: {
              ctin: "",
              trdnm: "Synthetic Blank-Ctin Trade Name",
            },
            numeric_counterparty: {
              ctin: 1,
              trdnm: "Synthetic Numeric-Ctin Trade Name",
            },
            amount: 1,
          },
        }),
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    expect(dataCsv).not.toContain("Synthetic Blank-Ctin Trade Name");
    expect(dataCsv).not.toContain("Synthetic Numeric-Ctin Trade Name");
    expect(dataCsv).toContain("/amount");
  });

  it("withholds a mislocated owner trade-name copy through the value net", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [
        rawJsonEntry("april-data.json", {
          data: {
            rtnprd: "042026",
            a: { b: { trdnm: "Synthetic Value-Net Owner Trade Name" } },
            owner_name_copy: "Synthetic Value-Net Owner Trade Name",
            amount: 1,
          },
        }),
      ],
    );

    const dataCsv = new TextDecoder().decode(summary.dataBytes);
    expect(dataCsv).not.toContain("Synthetic Value-Net Owner Trade Name");
    expect(dataCsv).toContain("/amount");
  });

  it("keeps an empty-key member as the slash pointer after envelope normalization", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-2B")],
      [jsonEntry("april-data.json", "GSTR-2B", { "": 7 })],
    );

    const rows = parseCsv(new TextDecoder().decode(summary.dataBytes));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          period: "April",
          outcome: "parseable-json",
          field_path: "/",
          value_number: "7",
        }),
      ]),
    );
  });

  it("expands a small GSTR-3B ITC array by its stable discriminator", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        jsonEntry("april-data.json", "GSTR-3B", {
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

  it("normalizes a response-shaped GSTR-3B envelope before expanding every configured array", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            r3b: {
              gstin: "27ABCDE1234F1Z0",
              ret_period: "042026",
              sup_details: {
                osup_det: { txval: 101, camt: 11, iamt: 12, samt: 13 },
                osup_nil_exmp: { txval: 201, camt: 21, iamt: 22, samt: 23, csamt: 24 },
                osup_nongst: { txval: 301, camt: 31, iamt: 32, samt: 33, csamt: 34 },
              },
              itc_elg: {
                itc_avl: [
                  { ty: "IMPG", camt: 21 },
                  { ty: "IMPS", camt: 22 },
                  { ty: "ISRC", camt: 23 },
                  { ty: "ISD", camt: 24 },
                  { ty: "OTH", camt: 25, csamt: 26 },
                ],
                itc_rev: [
                  { ty: "RUL", camt: 31 },
                  { ty: "OTH", camt: 32 },
                ],
                itc_inelg: [
                  { ty: "RUL", camt: 41 },
                  { ty: "OTH", camt: 42 },
                ],
              },
              inter_sup: {
                unreg_details: [
                  { pos: "01", txval: 51 },
                  { pos: "02", txval: 52 },
                ],
              },
              surrounding_decoy: { ignored: "synthetic" },
            },
          },
          response_decoy: "synthetic",
        }),
      ],
    );

    const rows = parseCsv(new TextDecoder().decode(summary.dataBytes));
    expect(fieldRow(rows, "/itc_elg/itc_avl/OTH/camt")).toMatchObject({
      outcome: "parseable-json",
      field_label: "Table 4(A)(5) All other ITC — Central tax",
      value_number: "25",
    });
    expect(fieldRow(rows, "/itc_elg/itc_rev/RUL/camt")).toMatchObject({
      outcome: "parseable-json",
      field_label:
        "Table 4(B)(1) ITC reversed — As per rules 38, 42 & 43 of CGST Rules and sub-section (5) of section 17 — Central tax",
    });
    expect(fieldRow(rows, "/itc_elg/itc_inelg/RUL/camt")).toMatchObject({
      outcome: "parseable-json",
      field_label:
        "Table 4(D)(1) Other Details — ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period — Central tax",
    });
    expect(fieldRow(rows, "/inter_sup/unreg_details/02/txval")).toMatchObject({
      outcome: "parseable-json",
      value_number: "52",
    });
    expect(fieldRow(rows, "/sup_details/osup_det/txval")).toMatchObject({
      field_label:
        "Table 3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted) — Taxable value",
    });
    expect(fieldRow(rows, "/sup_details/osup_nil_exmp/iamt")).toMatchObject({
      field_label: "",
    });
    expect(fieldRow(rows, "/sup_details/osup_nongst/csamt")).toMatchObject({
      field_label: "",
    });
    expect(fieldRow(rows, "/itc_elg/itc_avl/OTH/csamt")).toMatchObject({
      field_label: "Table 4(A)(5) All other ITC — Cess",
    });
  });

  it("emits a named outcome when the expected return envelope is missing", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          data: { unexpected_return: { ret_period: "042026", amount: 7 } },
          response_decoy: "synthetic",
        }),
      ],
    );

    expect(parseCsv(new TextDecoder().decode(summary.dataBytes))).toEqual([
      expect.objectContaining({
        period: "April",
        outcome: "json-envelope-missing",
        field_path: "pack:outcome",
        value_text: "",
        value_number: "",
      }),
    ]);
    expect(summary).toMatchObject({ outcomeOnly: true, parsedPeriodCount: 0, rowCount: 1 });
  });

  it("keeps an over-ceiling eligible array as one count row with a reason", () => {
    const elements = Array.from(
      { length: MAX_FILED_RETURNS_SUMMARY_ARRAY_EXPANSION_ELEMENTS + 1 },
      (_, index) => ({ ty: `T${index}`, camt: index + 1 }),
    );
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [jsonEntry("april-data.json", "GSTR-3B", { itc_elg: { itc_avl: elements } })],
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
        jsonEntry("april-data.json", "GSTR-3B", {
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
        jsonEntry("april-data.json", "GSTR-3B", {
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

  it("expands response-shaped Table 3.2 rows by pos and distinguishes empty siblings", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        jsonEntry("april-data.json", "GSTR-3B", {
          inter_sup: {
            unreg_details: [
              { pos: "01", txval: 101, iamt: 11 },
              { pos: "02", txval: 202, iamt: 22 },
            ],
            comp_details: [],
            uin_details: [],
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
    expect(fieldRow(rows, "/inter_sup/comp_details")).toMatchObject({
      outcome: "array-count-empty",
      value_number: "0",
    });
    expect(fieldRow(rows, "/inter_sup/uin_details")).toMatchObject({
      outcome: "array-count-empty",
      value_number: "0",
    });
  });

  it("keeps duplicate place-of-supply values as a named count row", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        jsonEntry("april-data.json", "GSTR-3B", {
          inter_sup: {
            unreg_details: [
              { pos: "01", txval: 101, iamt: 11 },
              { pos: "01", txval: 202, iamt: 22 },
            ],
          },
        }),
      ],
    );

    expect(
      fieldRow(parseCsv(new TextDecoder().decode(summary.dataBytes)), "/inter_sup/unreg_details"),
    ).toMatchObject({
      outcome: "array-count-duplicate-discriminator",
      value_number: "2",
    });
  });

  it("keeps the fixed column set across return types and different field sets", () => {
    const gstr1 = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-1")],
      [jsonEntry("april-data.json", "GSTR-1", { alpha: "0001", decoy: { only_gstr1: 12 } })],
    );
    const gstr2b = buildFiledReturnsSummarySheet(
      [jsonPlan("May", "may-data.json", "GSTR-2B")],
      [jsonEntry("may-data.json", "GSTR-2B", { beta: true, different_decoy: [1, 2, 3] }, "052026")],
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
          jsonEntry("april-data.json", "GSTR-3B", {
            gstin: "27ABCDE1234F1Z0",
            amount: 1,
          }),
          jsonEntry("may-data.json", "GSTR-3B", { gstin: "27FGHIJ5678K1Z1", amount: 2 }, "052026"),
        ],
      ),
    ).toThrow(FiledReturnsSummaryIdentityConflictError);
  });

  it("fails closed when any parseable GSTR-3B period omits its GSTIN", () => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [
          jsonPlan("April", "april-data.json", "GSTR-3B"),
          jsonPlan("May", "may-data.json", "GSTR-3B"),
        ],
        [
          rawJsonEntry("april-data.json", {
            status: 1,
            data: {
              lglnm: "Synthetic Legal Name",
              r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 },
            },
          }),
          rawJsonEntry("may-data.json", {
            status: 1,
            data: {
              lglnm: "Synthetic Legal Name",
              r3b: { ret_period: "052026", amount: 2 },
            },
          }),
        ],
      ),
    ).toThrow("Required taxpayer identity");
  });

  it("rejects a nonempty GSTR-3B GSTIN that fails the GST Portal checksum", () => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-3B")],
        [
          rawJsonEntry("april-data.json", {
            status: 1,
            data: {
              lglnm: "Synthetic Legal Name",
              r3b: { gstin: "27ABCDE1234F1Z1", ret_period: "042026", amount: 1 },
            },
          }),
        ],
      ),
    ).toThrow("GSTIN is invalid");
  });

  it.each([
    {
      label: "null GSTIN",
      document: {
        status: 1,
        data: {
          lglnm: "Synthetic Legal Name",
          r3b: { gstin: null, ret_period: "042026", amount: 1 },
        },
      },
    },
    {
      label: "boolean legal name",
      document: {
        status: 1,
        data: {
          lglnm: false,
          r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 },
        },
      },
    },
  ])("fails closed through the missing-identity path for a $label", ({ document }) => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-3B")],
        [rawJsonEntry("april-data.json", document)],
      ),
    ).toThrow("Required taxpayer identity is missing");
  });

  it.each([
    {
      label: "GSTIN outside the return envelope",
      document: {
        status: 1,
        gstin: "27ABCDE1234F1Z0",
        data: { lglnm: "Synthetic Legal Name", r3b: { ret_period: "042026", amount: 1 } },
      },
    },
    {
      label: "legal name in a metadata object",
      document: {
        status: 1,
        meta: { lglnm: "Synthetic Legal Name" },
        data: { r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 } },
      },
    },
    {
      label: "GSTIN one level below the canonical container",
      document: {
        status: 1,
        data: {
          lglnm: "Synthetic Legal Name",
          r3b: { taxpayer: { gstin: "27ABCDE1234F1Z0" }, ret_period: "042026", amount: 1 },
        },
      },
    },
  ])("rejects a decoy $label rather than attributing the return to it", ({ document }) => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-3B")],
        [rawJsonEntry("april-data.json", document)],
      ),
    ).toThrow(FiledReturnsSummaryUncanonicalIdentityError);
  });

  it("accepts a scalar-wrapped identity at the canonical response path", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            r3b: { gstin: { value: "27ABCDE1234F1Z0" }, ret_period: "042026", amount: 1 },
          },
        }),
      ],
    );

    expect(summary).toMatchObject({ outcomeOnly: false, parsedPeriodCount: 1 });
    expect(contextText(summary.contextRows)).toContain(
      "taxpayer_identity,identity,GSTIN,/data/r3b/gstin/value,27ABCDE1234F1Z0",
    );
  });

  it("still accepts the canonical identity when a matching decoy sits beside it", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          gstin: "27ABCDE1234F1Z0",
          data: {
            lglnm: "Synthetic Legal Name",
            r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 },
          },
        }),
      ],
    );

    expect(summary).toMatchObject({ outcomeOnly: false, parsedPeriodCount: 1 });
    expect(contextText(summary.contextRows)).toContain("27ABCDE1234F1Z0");
  });

  it("treats an optional non-string taxpayer identity as absent", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            trdnm: false,
            r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 },
          },
        }),
      ],
    );

    expect(summary).toMatchObject({ outcomeOnly: false, parsedPeriodCount: 1 });
    expect(summary.contextRows.some((row) => row.fieldLabel === "Trade name")).toBe(false);
  });

  it("allows an optional taxpayer identity to be absent from another parseable period", () => {
    const summary = buildFiledReturnsSummarySheet(
      [
        jsonPlan("April", "april-data.json", "GSTR-3B"),
        jsonPlan("May", "may-data.json", "GSTR-3B"),
      ],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            trdnm: "Synthetic Optional Trade Name",
            r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 },
          },
        }),
        rawJsonEntry("may-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "052026", amount: 2 },
          },
        }),
      ],
    );

    expect(summary).toMatchObject({ outcomeOnly: false, parsedPeriodCount: 2 });
    expect(contextText(summary.contextRows)).toContain("Synthetic Optional Trade Name");
  });

  it("still rejects different values for the same optional taxpayer identity", () => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [
          jsonPlan("April", "april-data.json", "GSTR-3B"),
          jsonPlan("May", "may-data.json", "GSTR-3B"),
        ],
        [
          rawJsonEntry("april-data.json", {
            status: 1,
            data: {
              lglnm: "Synthetic Legal Name",
              trdnm: "Synthetic Trade Name One",
              r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 },
            },
          }),
          rawJsonEntry("may-data.json", {
            status: 1,
            data: {
              lglnm: "Synthetic Legal Name",
              trdnm: "Synthetic Trade Name Two",
              r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "052026", amount: 2 },
            },
          }),
        ],
      ),
    ).toThrow(FiledReturnsSummaryIdentityConflictError);
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
    "passphrase",
    "passcode",
    "credential",
    "credentials",
    "api_key",
    "x_api_key",
    "x_auth_header",
    "x_auth_key",
    "jwt",
    "bearer",
    "x_auth",
    "userId",
    "user_id",
    "client_id",
    "client_identifier",
    "user_identifier",
    "access_key",
    "accessKeyId",
    "recovery_code",
    "recovery_key",
    "security_answer",
    "otp_code",
    "otp_value",
    "totp_code",
    "hotp_code",
    "mfa_code",
    "two_factor_code",
    "auth_code",
    "x_auth_code",
    "auth_code_value",
    "access_key_value",
  ])("fails summary generation when portal JSON contains forbidden %s material", (field) => {
    const secret = "synthetic-sensitive-value";
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-2B")],
        [jsonEntry("april-data.json", "GSTR-2B", { amount: 1, [field]: secret })],
      ),
    ).toThrow("credential or session field");
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-2B")],
        [jsonEntry("april-data.json", "GSTR-2B", { amount: 1, [field]: secret })],
      ),
    ).not.toThrow(secret);
  });

  it.each(["session", "safe/session", "~session"])(
    "fails summary generation when forbidden ancestor container %s is pointer-decoded",
    (ancestor) => {
      expect(() =>
        buildFiledReturnsSummarySheet(
          [jsonPlan("April", "april-data.json", "GSTR-2B")],
          [
            jsonEntry("april-data.json", "GSTR-2B", {
              amount: 1,
              [ancestor]: { id: "synthetic-sensitive" },
            }),
          ],
        ),
      ).toThrow("credential or session field");
    },
  );

  it.each(["login", "user", "client"])(
    "fails summary generation when split credential container %s has an id leaf",
    (container) => {
      expect(() =>
        buildFiledReturnsSummarySheet(
          [jsonPlan("April", "april-data.json", "GSTR-2B")],
          [
            jsonEntry("april-data.json", "GSTR-2B", {
              amount: 1,
              [container]: { id: "synthetic-sensitive" },
            }),
          ],
        ),
      ).toThrow("credential or session field");
    },
  );

  it.each(["loginId", "userId", "clientId"])(
    "keeps combined credential spelling %s forbidden",
    (field) => {
      expect(() =>
        buildFiledReturnsSummarySheet(
          [jsonPlan("April", "april-data.json", "GSTR-2B")],
          [jsonEntry("april-data.json", "GSTR-2B", { amount: 1, [field]: "synthetic-sensitive" })],
        ),
      ).toThrow("credential or session field");
    },
  );

  it.each([
    ["api", "key"],
    ["access", "key"],
    ["recovery", "code"],
    ["login", "id"],
  ])(
    "fails summary generation when credential spelling /%s/%s is split across adjacent segments",
    (container, leaf) => {
      expect(() =>
        buildFiledReturnsSummarySheet(
          [jsonPlan("April", "april-data.json", "GSTR-2B")],
          [
            jsonEntry("april-data.json", "GSTR-2B", {
              amount: 1,
              [container]: { [leaf]: "synthetic-sensitive" },
            }),
          ],
        ),
      ).toThrow("credential or session field");
    },
  );

  it("fails summary generation when a credential spelling is split across deeper nesting", () => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-2B")],
        [
          jsonEntry("april-data.json", "GSTR-2B", {
            amount: 1,
            api: { k: { ey: "synthetic-sensitive" } },
          }),
        ],
      ),
    ).toThrow("credential or session field");
  });

  it("still emits realistic mapped GSTR-3B paths that sit beside short segments", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("April", "april-data.json", "GSTR-3B")],
      [
        rawJsonEntry("april-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            r3b: {
              gstin: "27ABCDE1234F1Z0",
              ret_period: "042026",
              sup_details: { osup_det: { txval: 12.5 } },
              itc_elg: { itc_avl: [{ ty: "ISD", iamt: 3 }] },
            },
          },
        }),
      ],
    );

    const dataRows = parseCsv(new TextDecoder().decode(summary.dataBytes));
    expect(fieldRow(dataRows, "/sup_details/osup_det/txval")).toMatchObject({
      value_number: "12.5",
    });
    expect(fieldRow(dataRows, "/itc_elg/itc_avl/ISD/iamt")).toMatchObject({ value_number: "3" });
  });

  it("does not reject a benign longer segment containing a credential container word", () => {
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-2B")],
        [
          jsonEntry("april-data.json", "GSTR-2B", {
            clientidentity: { id: "synthetic-benign-value" },
          }),
        ],
      ),
    ).not.toThrow();
  });

  it("rejects forbidden material outside the normalized return envelope", () => {
    const secret = "synthetic-outside-envelope-sensitive-value";
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-3B")],
        [
          rawJsonEntry("april-data.json", {
            status: 1,
            outside: { cookie: secret },
            data: {
              lglnm: "Synthetic Legal Name",
              r3b: { gstin: "27ABCDE1234F1Z0", ret_period: "042026", amount: 1 },
            },
          }),
        ],
      ),
    ).toThrow("credential or session field");
    expect(() =>
      buildFiledReturnsSummarySheet(
        [jsonPlan("April", "april-data.json", "GSTR-3B")],
        [
          rawJsonEntry("april-data.json", {
            status: 1,
            outside: { cookie: secret },
            data: { r3b: { ret_period: "042026", amount: 1 } },
          }),
        ],
      ),
    ).not.toThrow(secret);
  });

  it("bounds retained JSON Pointer paths before descending into wide nested keys", () => {
    const wideKeys = Array.from({ length: 12 }, (_, index) => `${index}-${"k".repeat(180)}`);
    const nested = `${wideKeys.map((key) => `{"${key}":`).join("")}"leaf"${"}".repeat(wideKeys.length)}`;
    const json = `{"data":${nested},"response_decoy":"synthetic"}`;

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
          "portal-pdf-row-text",
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
    ).toBe("portal-pdf-row-text");
    expect(
      FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE["GSTR-3B"]["/sup_details/osup_zero/txval"]
        ?.provenance.evidence,
    ).toBe("official-offline-utility");
    for (const path of [
      "/sup_details/osup_nil_exmp/iamt",
      "/sup_details/osup_nil_exmp/camt",
      "/sup_details/osup_nil_exmp/samt",
      "/sup_details/osup_nil_exmp/csamt",
      "/sup_details/osup_nongst/iamt",
      "/sup_details/osup_nongst/camt",
      "/sup_details/osup_nongst/samt",
      "/sup_details/osup_nongst/csamt",
    ]) {
      expect(FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE["GSTR-3B"][path]).toBeUndefined();
    }
    for (const path of [
      "/itc_elg/itc_avl/OTH/csamt",
      "/itc_elg/itc_net/csamt",
      "/itc_elg/itc_avl/IMPG/csamt",
      "/itc_elg/itc_avl/IMPS/csamt",
      "/itc_elg/itc_avl/ISRC/csamt",
      "/itc_elg/itc_avl/ISD/csamt",
      "/itc_elg/itc_rev/RUL/csamt",
      "/itc_elg/itc_rev/OTH/csamt",
      "/itc_elg/itc_inelg/RUL/csamt",
      "/itc_elg/itc_inelg/OTH/csamt",
    ]) {
      const entry = FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE["GSTR-3B"][path];
      expect(entry?.label.length).toBeGreaterThan(0);
      expect(entry?.provenance.evidence).toBe("portal-pdf-row-text");
    }
  });

  it("uses the adjacent July old and August current Table 4(D)(1) captions", () => {
    expect(
      filedReturnsSummaryFieldLabel("GSTR-3B", "/itc_elg/itc_inelg/RUL/camt", {
        financialYear: "2022-23",
        period: "July",
      }),
    ).toBe("Table 4(D)(1) Ineligible ITC — As per section 17(5) — Central tax");
    expect(
      filedReturnsSummaryFieldLabel("GSTR-3B", "/itc_elg/itc_inelg/RUL/camt", {
        financialYear: "2022-23",
        period: "August",
      }),
    ).toBe(
      "Table 4(D)(1) Other Details — ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period — Central tax",
    );
  });

  it("uses the captured July 2022 caption for Table 4(B)(1)", () => {
    expect(
      filedReturnsSummaryFieldLabel("GSTR-3B", "/itc_elg/itc_rev/RUL/camt", {
        financialYear: "2022-23",
        period: "July",
      }),
    ).toBe("Table 4(B)(1) ITC reversed — As per rules 42 & 43 of CGST Rules — Central tax");
  });

  it("keeps both adjacent old captures, the current capture, and stable captions distinct", () => {
    const june2022 = { financialYear: "2022-23", period: "June" } as const;
    const july2022 = { financialYear: "2022-23", period: "July" } as const;
    const december2025 = { financialYear: "2025-26", period: "December" } as const;
    for (const filingPeriod of [june2022, july2022]) {
      expect(
        filedReturnsSummaryFieldLabel("GSTR-3B", "/itc_elg/itc_inelg/OTH/camt", filingPeriod),
      ).toBe("Table 4(D)(2) Ineligible ITC — Others — Central tax");
      expect(
        filedReturnsSummaryFieldLabel("GSTR-3B", "/itc_elg/itc_inelg/RUL/camt", filingPeriod),
      ).not.toContain("reclaimed");
    }
    expect(
      filedReturnsSummaryFieldLabel("GSTR-3B", "/itc_elg/itc_rev/RUL/camt", december2025),
    ).toBe(
      "Table 4(B)(1) ITC reversed — As per rules 38, 42 & 43 of CGST Rules and sub-section (5) of section 17 — Central tax",
    );
    expect(
      filedReturnsSummaryFieldLabel("GSTR-3B", "/itc_elg/itc_inelg/RUL/camt", december2025),
    ).toContain("ITC reclaimed");
    for (const path of ["/itc_elg/itc_avl/ISRC/camt", "/sup_details/osup_det/txval"]) {
      const labels = [june2022, july2022, december2025].map((filingPeriod) =>
        filedReturnsSummaryFieldLabel("GSTR-3B", path, filingPeriod),
      );
      expect(new Set(labels)).toHaveLength(1);
    }
  });

  it("renders the current Table 4 captions in the August 2022 summary CSV", () => {
    const summary = buildFiledReturnsSummarySheet(
      [jsonPlan("August", "august-data.json", "GSTR-3B", "2022-23")],
      [
        rawJsonEntry("august-data.json", {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            r3b: {
              gstin: "27ABCDE1234F1Z0",
              ret_period: "082022",
              itc_elg: {
                itc_avl: [{ ty: "ISRC", camt: 11 }],
                itc_rev: [{ ty: "RUL", camt: 12 }],
                itc_inelg: [
                  { ty: "RUL", camt: 13 },
                  { ty: "OTH", camt: 14 },
                ],
              },
            },
          },
        }),
      ],
    );
    const rows = parseCsv(new TextDecoder().decode(summary.dataBytes));
    for (const { path, expectedLabel } of [
      {
        path: "/itc_elg/itc_rev/RUL/camt",
        expectedLabel:
          "Table 4(B)(1) ITC reversed — As per rules 38, 42 & 43 of CGST Rules and sub-section (5) of section 17 — Central tax",
      },
      {
        path: "/itc_elg/itc_inelg/RUL/camt",
        expectedLabel:
          "Table 4(D)(1) Other Details — ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period — Central tax",
      },
      {
        path: "/itc_elg/itc_inelg/OTH/camt",
        expectedLabel:
          "Table 4(D)(2) Other Details — Ineligible ITC under section 16(4) & ITC restricted due to PoS rules — Central tax",
      },
    ]) {
      const row = fieldRow(rows, path);
      expect(row.field_label).toBe(expectedLabel);
      expect(row.value_number).not.toBe("");
    }
    expect(fieldRow(rows, "/itc_elg/itc_avl/ISRC/camt").field_label).toContain("Inward supplies");
  });
});

function jsonPlan(
  period: FiledReturnsMonth,
  entryName: string,
  returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B",
  financialYear = "2026-27",
): FiledReturnsSummaryPlanEntry {
  return {
    artifactType: "JSON",
    entryNames: [entryName],
    financialYear,
    outcomeCategory: "staged",
    period,
    returnType,
  };
}

function jsonEntry(
  path: string,
  returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B",
  value: Record<string, unknown>,
  returnPeriod = "042026",
) {
  const document =
    returnType === "GSTR-3B"
      ? {
          status: 1,
          data: {
            lglnm: "Synthetic Legal Name",
            r3b: { gstin: "27ABCDE1234F1Z0", ret_period: returnPeriod, ...value },
          },
          response_decoy: "synthetic",
        }
      : {
          data: {
            [returnType === "GSTR-2B" ? "rtnprd" : "ret_period"]: returnPeriod,
            ...value,
          },
          response_decoy: "synthetic",
        };
  return rawJsonEntry(path, document);
}

function rawJsonEntry(path: string, value: unknown) {
  return { path, bytes: new TextEncoder().encode(JSON.stringify(value)) };
}

function contextText(
  rows: readonly {
    contextType: string;
    contextKey: string;
    fieldLabel: string;
    fieldPath: string;
    valueText: string;
  }[],
): string {
  return rows
    .map((row) =>
      [row.contextType, row.contextKey, row.fieldLabel, row.fieldPath, row.valueText].join(","),
    )
    .join("\n");
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

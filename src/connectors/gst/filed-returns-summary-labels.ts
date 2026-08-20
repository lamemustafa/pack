import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export interface FiledReturnsSummaryFieldLabel {
  label: string;
  provenance: {
    evidence:
      | "official-offline-utility"
      | "portal-pdf-value-cross-check-two-periods"
      | "portal-pdf-row-text";
    officialSource: string;
    officialSourceLocation: string;
    reviewedOn: string;
  };
  statement?: FiledReturnsStatementLineItem;
}

type FiledReturnsStatementCoverageTable = "3.1" | "4";

export interface FiledReturnsStatementLineItem {
  coverageTable: FiledReturnsStatementCoverageTable;
  sectionCaption: string;
  sectionOrder: number;
  shortLabel: "Taxable Value" | "Value" | "IGST" | "CGST" | "SGST" | "Cess";
  subrowOrder: number;
}

type FiledReturnsSummaryFieldLabelMap = Readonly<Record<string, FiledReturnsSummaryFieldLabel>>;

const GSTR3B_SOURCE = "GST Portal GSTR-3B Offline Utility V5.8 and Form GSTR-3B user guide";
const GSTR3B_PDF_CROSS_CHECK_SOURCE = "GST Portal GSTR-3B PDF export and JSON schema";
const REVIEWED_ON = "2026-08-20";

const GSTR3B_STATEMENT_TABLE_COVERAGE = [
  { table: "3.1", status: "included" },
  { table: "4", status: "included" },
  { table: "3.1.1", status: "not-included" },
  { table: "3.2", status: "not-included" },
  { table: "5.1", status: "not-included" },
  { table: "6.1", status: "not-included" },
] as const;

type ComponentKey = "txval" | "iamt" | "camt" | "samt" | "csamt";
const COMPONENT_LABELS: Record<ComponentKey, string> = {
  txval: "Taxable value",
  iamt: "Integrated tax",
  camt: "Central tax",
  samt: "State/UT tax",
  csamt: "Cess",
};
const STATEMENT_COMPONENT_LABELS: Record<
  ComponentKey,
  FiledReturnsStatementLineItem["shortLabel"]
> = {
  txval: "Taxable Value",
  iamt: "IGST",
  camt: "CGST",
  samt: "SGST",
  csamt: "Cess",
};
const STATEMENT_COMPONENT_ORDER: Record<ComponentKey, number> = {
  txval: 0,
  iamt: 1,
  camt: 2,
  samt: 3,
  csamt: 4,
};

function gstr3bLabel(
  label: string,
  table: "3.1(a)" | "3.1(b)" | "3.1(c)" | "3.1(d)" | "3.1(e)",
  jsonObject: "osup_det" | "osup_zero" | "osup_nil_exmp" | "isup_rev" | "osup_nongst",
): FiledReturnsSummaryFieldLabel {
  return {
    label,
    provenance: {
      evidence: "official-offline-utility",
      officialSource: GSTR3B_SOURCE,
      officialSourceLocation: `Form GSTR-3B Table ${table}; offline utility JSON generator sup_details.${jsonObject}`,
      reviewedOn: REVIEWED_ON,
    },
  };
}

function valueConfirmedLabel(label: string, table: string): FiledReturnsSummaryFieldLabel {
  return {
    label,
    provenance: {
      evidence: "portal-pdf-value-cross-check-two-periods",
      officialSource: GSTR3B_PDF_CROSS_CHECK_SOURCE,
      officialSourceLocation: `Value-matched between portal JSON and the portal PDF export in two independent periods; Form GSTR-3B Table ${table}.`,
      reviewedOn: REVIEWED_ON,
    },
  };
}

function portalPdfRowTextLabel(label: string, table: string): FiledReturnsSummaryFieldLabel {
  return {
    label,
    provenance: {
      evidence: "portal-pdf-row-text",
      officialSource: GSTR3B_PDF_CROSS_CHECK_SOURCE,
      officialSourceLocation: `Caption transcribed from Form GSTR-3B Table ${table} portal PDF row text; tax component comes from the portal PDF column heading. This evidence does not claim a JSON value match.`,
      reviewedOn: REVIEWED_ON,
    },
  };
}

function componentEntries(
  basePath: string,
  labelPrefix: string,
  table: string,
  components: readonly ComponentKey[],
  provenance: "confirmed" | "portal-pdf",
  statementCoverageTable?: FiledReturnsStatementCoverageTable,
  statementSectionOrder?: number,
): Record<string, FiledReturnsSummaryFieldLabel> {
  return Object.fromEntries(
    components.map((component) => {
      const label = `${labelPrefix} — ${COMPONENT_LABELS[component]}`;
      return [
        `${basePath}/${component}`,
        withOptionalStatement(
          provenance === "confirmed"
            ? valueConfirmedLabel(label, table)
            : portalPdfRowTextLabel(label, table),
          labelPrefix,
          component,
          statementCoverageTable,
          statementSectionOrder,
        ),
      ];
    }),
  );
}

function withOptionalStatement(
  entry: FiledReturnsSummaryFieldLabel,
  sectionCaption: string,
  component: ComponentKey,
  coverageTable?: FiledReturnsStatementCoverageTable,
  sectionOrder?: number,
  shortLabel = STATEMENT_COMPONENT_LABELS[component],
): FiledReturnsSummaryFieldLabel {
  if (coverageTable === undefined && sectionOrder === undefined) return entry;
  if (
    coverageTable === undefined ||
    sectionOrder === undefined ||
    !sectionCaption.startsWith(`Table ${coverageTable}(`)
  ) {
    throw new TypeError("Statement line is outside the verified table coverage.");
  }
  return {
    ...entry,
    statement: {
      coverageTable,
      sectionCaption,
      sectionOrder,
      shortLabel,
      subrowOrder: STATEMENT_COMPONENT_ORDER[component],
    },
  };
}

const GSTR3B_LABELS: FiledReturnsSummaryFieldLabelMap = {
  ...componentEntries(
    "/sup_details/osup_det",
    "Table 3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted)",
    "3.1(a)",
    ["txval", "camt", "iamt", "samt"],
    "confirmed",
    "3.1",
    0,
  ),
  "/sup_details/osup_det/csamt": withOptionalStatement(
    gstr3bLabel(
      "Table 3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted) — Cess",
      "3.1(a)",
      "osup_det",
    ),
    "Table 3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted)",
    "csamt",
    "3.1",
    0,
  ),
  "/sup_details/osup_zero/txval": withOptionalStatement(
    gstr3bLabel(
      "Table 3.1(b) Zero-rated outward taxable supplies — Taxable value",
      "3.1(b)",
      "osup_zero",
    ),
    "Table 3.1(b) Outward taxable supplies (zero rated)",
    "txval",
    "3.1",
    1,
  ),
  "/sup_details/osup_zero/iamt": withOptionalStatement(
    gstr3bLabel(
      "Table 3.1(b) Zero-rated outward taxable supplies — Integrated tax",
      "3.1(b)",
      "osup_zero",
    ),
    "Table 3.1(b) Outward taxable supplies (zero rated)",
    "iamt",
    "3.1",
    1,
  ),
  "/sup_details/osup_zero/camt": gstr3bLabel(
    "Table 3.1(b) Zero-rated outward taxable supplies — Central tax",
    "3.1(b)",
    "osup_zero",
  ),
  "/sup_details/osup_zero/samt": gstr3bLabel(
    "Table 3.1(b) Zero-rated outward taxable supplies — State/UT tax",
    "3.1(b)",
    "osup_zero",
  ),
  "/sup_details/osup_zero/csamt": withOptionalStatement(
    gstr3bLabel("Table 3.1(b) Zero-rated outward taxable supplies — Cess", "3.1(b)", "osup_zero"),
    "Table 3.1(b) Outward taxable supplies (zero rated)",
    "csamt",
    "3.1",
    1,
  ),
  "/sup_details/osup_nil_exmp/txval": withOptionalStatement(
    gstr3bLabel(
      "Table 3.1(c) Nil-rated and exempt outward supplies — Value",
      "3.1(c)",
      "osup_nil_exmp",
    ),
    "Table 3.1(c) Other outward supplies (Nil rated, exempted)",
    "txval",
    "3.1",
    2,
    "Value",
  ),
  "/sup_details/isup_rev/txval": withOptionalStatement(
    valueConfirmedLabel(
      "Table 3.1(d) Inward supplies liable to reverse charge — Taxable value",
      "3.1(d)",
    ),
    "Table 3.1(d) Inward supplies (liable to reverse charge)",
    "txval",
    "3.1",
    3,
  ),
  "/sup_details/isup_rev/iamt": withOptionalStatement(
    gstr3bLabel(
      "Table 3.1(d) Inward supplies liable to reverse charge — Integrated tax",
      "3.1(d)",
      "isup_rev",
    ),
    "Table 3.1(d) Inward supplies (liable to reverse charge)",
    "iamt",
    "3.1",
    3,
  ),
  "/sup_details/isup_rev/camt": withOptionalStatement(
    gstr3bLabel(
      "Table 3.1(d) Inward supplies liable to reverse charge — Central tax",
      "3.1(d)",
      "isup_rev",
    ),
    "Table 3.1(d) Inward supplies (liable to reverse charge)",
    "camt",
    "3.1",
    3,
  ),
  "/sup_details/isup_rev/samt": withOptionalStatement(
    gstr3bLabel(
      "Table 3.1(d) Inward supplies liable to reverse charge — State/UT tax",
      "3.1(d)",
      "isup_rev",
    ),
    "Table 3.1(d) Inward supplies (liable to reverse charge)",
    "samt",
    "3.1",
    3,
  ),
  "/sup_details/isup_rev/csamt": withOptionalStatement(
    gstr3bLabel(
      "Table 3.1(d) Inward supplies liable to reverse charge — Cess",
      "3.1(d)",
      "isup_rev",
    ),
    "Table 3.1(d) Inward supplies (liable to reverse charge)",
    "csamt",
    "3.1",
    3,
  ),
  "/sup_details/osup_nongst/txval": withOptionalStatement(
    gstr3bLabel("Table 3.1(e) Non-GST outward supplies — Value", "3.1(e)", "osup_nongst"),
    "Table 3.1(e) Non-GST outward supplies",
    "txval",
    "3.1",
    4,
    "Value",
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/OTH",
    "Table 4(A)(5) All other ITC",
    "4(A)(5)",
    ["camt", "iamt", "samt"],
    "confirmed",
    "4",
    9,
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/OTH",
    "Table 4(A)(5) All other ITC",
    "4(A)(5)",
    ["csamt"],
    "portal-pdf",
    "4",
    9,
  ),
  ...componentEntries(
    "/itc_elg/itc_net",
    "Table 4(C) Net ITC available (A) − (B)",
    "4(C)",
    ["camt", "iamt", "samt"],
    "confirmed",
    "4",
    12,
  ),
  ...componentEntries(
    "/itc_elg/itc_net",
    "Table 4(C) Net ITC available (A) − (B)",
    "4(C)",
    ["csamt"],
    "portal-pdf",
    "4",
    12,
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/IMPG",
    "Table 4(A)(1) Import of goods",
    "4(A)(1)",
    ["camt", "iamt", "samt", "csamt"],
    "portal-pdf",
    "4",
    5,
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/IMPS",
    "Table 4(A)(2) Import of services",
    "4(A)(2)",
    ["camt", "iamt", "samt", "csamt"],
    "portal-pdf",
    "4",
    6,
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/ISRC",
    "Table 4(A)(3) Inward supplies liable to reverse charge (other than 1 & 2 above)",
    "4(A)(3)",
    ["camt", "iamt", "samt", "csamt"],
    "portal-pdf",
    "4",
    7,
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/ISD",
    "Table 4(A)(4) Inward supplies from ISD",
    "4(A)(4)",
    ["camt", "iamt", "samt", "csamt"],
    "portal-pdf",
    "4",
    8,
  ),
  ...componentEntries(
    "/itc_elg/itc_rev/RUL",
    "Table 4(B)(1) ITC reversed — As per rules 38, 42 & 43 of CGST Rules and sub-section (5) of section 17",
    "4(B)(1)",
    ["camt", "iamt", "samt", "csamt"],
    "portal-pdf",
    "4",
    10,
  ),
  ...componentEntries(
    "/itc_elg/itc_rev/OTH",
    "Table 4(B)(2) ITC reversed — Others",
    "4(B)(2)",
    ["camt", "iamt", "samt", "csamt"],
    "portal-pdf",
    "4",
    11,
  ),
  ...componentEntries(
    "/itc_elg/itc_inelg/RUL",
    "Table 4(D)(1) Other Details — ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period",
    "4(D)(1)",
    ["camt", "iamt", "samt", "csamt"],
    "portal-pdf",
    "4",
    13,
  ),
  ...componentEntries(
    "/itc_elg/itc_inelg/OTH",
    "Table 4(D)(2) Other Details — Ineligible ITC under section 16(4) & ITC restricted due to PoS rules",
    "4(D)(2)",
    ["camt", "iamt", "samt", "csamt"],
    "portal-pdf",
    "4",
    14,
  ),
};

export const FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE: Readonly<
  Record<FiledReturnsReturnType, FiledReturnsSummaryFieldLabelMap>
> = {
  "GSTR-1": {},
  "GSTR-2B": {},
  "GSTR-3B": GSTR3B_LABELS,
};

export function filedReturnsSummaryFieldLabel(
  returnType: FiledReturnsReturnType,
  path: string,
): string {
  return FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE[returnType][path]?.label ?? "";
}

export function filedReturnsStatementLineItems(): Array<
  FiledReturnsStatementLineItem & { fieldPath: string }
> {
  return Object.entries(GSTR3B_LABELS)
    .flatMap(([fieldPath, entry]) => (entry.statement ? [{ fieldPath, ...entry.statement }] : []))
    .sort(
      (left, right) =>
        left.sectionOrder - right.sectionOrder || left.subrowOrder - right.subrowOrder,
    );
}

export function filedReturnsStatementCoverage(): {
  includedTables: string[];
  excludedTables: string[];
} {
  return {
    includedTables: [
      ...new Set(filedReturnsStatementLineItems().map((lineItem) => lineItem.coverageTable)),
    ],
    excludedTables: GSTR3B_STATEMENT_TABLE_COVERAGE.filter(
      ({ status }) => status === "not-included",
    ).map(({ table }) => table),
  };
}

export function filedReturnsSummaryIdentityLabel(path: string): string | null {
  return filedReturnsSummaryIdentity(path)?.label ?? null;
}

export interface FiledReturnsSummaryIdentity {
  contextType: "taxpayer_identity" | "return_identity";
  label: string;
}

export function filedReturnsSummaryIdentity(path: string): FiledReturnsSummaryIdentity | null {
  const tokens = canonicalPathTokens(path);
  const terminalIdentity = identityForCanonicalToken(tokens.at(-1) ?? "");
  if (terminalIdentity) return terminalIdentity;
  if (tokens.at(-1) === "value") {
    return identityForCanonicalToken(tokens.at(-2) ?? "");
  }
  return null;
}

export function isFiledReturnsSummaryIdentityPath(path: string): boolean {
  return canonicalPathTokens(path).some(
    (canonicalToken) => identityForCanonicalToken(canonicalToken) !== null,
  );
}

function identityForCanonicalToken(canonicalToken: string): FiledReturnsSummaryIdentity | null {
  if (canonicalToken === "gstin") return taxpayerIdentity("GSTIN");
  if (canonicalToken === "pan" || canonicalToken === "panno" || canonicalToken === "taxpayerpan") {
    return taxpayerIdentity("PAN");
  }
  if (canonicalToken === "lglnm" || canonicalToken === "lgnm" || canonicalToken === "legalname") {
    return taxpayerIdentity("Legal name");
  }
  if (canonicalToken === "trdnm" || canonicalToken === "tradename") {
    return taxpayerIdentity("Trade name");
  }
  if (canonicalToken === "arn") return returnIdentity("ARN");
  if (canonicalToken === "arndt" || canonicalToken === "arndate") {
    return returnIdentity("ARN date");
  }
  if (
    canonicalToken === "taxpayername" ||
    canonicalToken === "taxpyrname" ||
    canonicalToken === "nameoftaxpayer"
  ) {
    return taxpayerIdentity("Taxpayer name");
  }
  if (
    canonicalToken === "signatory" ||
    canonicalToken === "authsig" ||
    canonicalToken === "signatoryname" ||
    canonicalToken === "authorizedsignatory" ||
    canonicalToken === "authorisedsignatory"
  ) {
    return taxpayerIdentity("Signatory");
  }
  if (canonicalToken === "designation" || canonicalToken === "desig") {
    return taxpayerIdentity("Designation");
  }
  return null;
}

function taxpayerIdentity(label: string): FiledReturnsSummaryIdentity {
  return { contextType: "taxpayer_identity", label };
}

function returnIdentity(label: string): FiledReturnsSummaryIdentity {
  return { contextType: "return_identity", label };
}

export function isFiledReturnsSummaryForbiddenFieldPath(path: string): boolean {
  return canonicalPathTokens(path).some(isForbiddenCanonicalToken);
}

function isForbiddenCanonicalToken(canonicalToken: string): boolean {
  return (
    canonicalToken === "auth" ||
    canonicalToken.endsWith("apikey") ||
    canonicalToken.endsWith("authheader") ||
    canonicalToken.endsWith("authkey") ||
    canonicalToken === "authentication" ||
    canonicalToken === "authn" ||
    canonicalToken === "authz" ||
    canonicalToken === "bearer" ||
    canonicalToken === "jwt" ||
    canonicalToken === "loginid" ||
    canonicalToken === "nonce" ||
    canonicalToken === "pin" ||
    canonicalToken === "mpin" ||
    canonicalToken === "pwd" ||
    canonicalToken === "sid" ||
    canonicalToken === "username" ||
    canonicalToken === "xauth" ||
    canonicalToken.endsWith("token") ||
    canonicalToken.includes("authorization") ||
    canonicalToken.includes("bearer") ||
    canonicalToken.includes("captcha") ||
    canonicalToken.includes("cookie") ||
    canonicalToken.includes("credential") ||
    canonicalToken.includes("csrf") ||
    canonicalToken.includes("oauth") ||
    canonicalToken.includes("passcode") ||
    canonicalToken.includes("xsrf") ||
    canonicalToken.includes("pass" + "word") ||
    canonicalToken.includes("passwd") ||
    canonicalToken.includes("passphrase") ||
    canonicalToken.includes("privatekey") ||
    canonicalToken.includes("saml") ||
    canonicalToken.includes("secret") ||
    canonicalToken.includes("session") ||
    canonicalToken.includes("sessid") ||
    canonicalToken === "otp" ||
    canonicalToken.endsWith("otp")
  );
}

function canonicalPathTokens(path: string): string[] {
  if (path === "") return [];
  return path
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

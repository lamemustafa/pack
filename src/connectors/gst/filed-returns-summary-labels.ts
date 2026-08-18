import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export interface FiledReturnsSummaryFieldLabel {
  label: string;
  provenance: {
    evidence:
      | "official-offline-utility"
      | "portal-pdf-value-cross-check-two-periods"
      | "form-vocabulary-and-row-order";
    officialSource: string;
    officialSourceLocation: string;
    reviewedOn: string;
  };
}

type FiledReturnsSummaryFieldLabelMap = Readonly<Record<string, FiledReturnsSummaryFieldLabel>>;

const GSTR3B_SOURCE = "GST Portal GSTR-3B Offline Utility V5.8 and Form GSTR-3B user guide";
const GSTR3B_PDF_CROSS_CHECK_SOURCE = "GST Portal GSTR-3B PDF export and JSON schema";
const GSTR3B_VOCABULARY_SOURCE = "GST Portal GSTR-3B JSON type codes and Form row order";
const REVIEWED_ON = "2026-08-18";

type ComponentKey = "txval" | "iamt" | "camt" | "samt" | "csamt";
const COMPONENT_LABELS: Record<ComponentKey, string> = {
  txval: "Taxable value",
  iamt: "Integrated tax",
  camt: "Central tax",
  samt: "State/UT tax",
  csamt: "Cess",
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

function vocabularyDerivedLabel(label: string, table: string): FiledReturnsSummaryFieldLabel {
  return {
    label,
    provenance: {
      evidence: "form-vocabulary-and-row-order",
      officialSource: GSTR3B_VOCABULARY_SOURCE,
      officialSourceLocation: `Vocabulary-derived from the JSON ty code and Form GSTR-3B Table ${table} row order; sampled evidence was not value-matched.`,
      reviewedOn: REVIEWED_ON,
    },
  };
}

function componentEntries(
  basePath: string,
  labelPrefix: string,
  table: string,
  components: readonly ComponentKey[],
  provenance: "confirmed" | "vocabulary",
): Record<string, FiledReturnsSummaryFieldLabel> {
  return Object.fromEntries(
    components.map((component) => {
      const label = `${labelPrefix} — ${COMPONENT_LABELS[component]}`;
      return [
        `${basePath}/${component}`,
        provenance === "confirmed"
          ? valueConfirmedLabel(label, table)
          : vocabularyDerivedLabel(label, table),
      ];
    }),
  );
}

const GSTR3B_LABELS: FiledReturnsSummaryFieldLabelMap = {
  ...componentEntries(
    "/sup_details/osup_det",
    "Table 3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted)",
    "3.1(a)",
    ["txval", "camt", "iamt", "samt"],
    "confirmed",
  ),
  "/sup_details/osup_det/csamt": gstr3bLabel(
    "Table 3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted) — Cess",
    "3.1(a)",
    "osup_det",
  ),
  "/sup_details/osup_zero/txval": gstr3bLabel(
    "Table 3.1(b) Zero-rated outward taxable supplies — Taxable value",
    "3.1(b)",
    "osup_zero",
  ),
  "/sup_details/osup_zero/iamt": gstr3bLabel(
    "Table 3.1(b) Zero-rated outward taxable supplies — Integrated tax",
    "3.1(b)",
    "osup_zero",
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
  "/sup_details/osup_zero/csamt": gstr3bLabel(
    "Table 3.1(b) Zero-rated outward taxable supplies — Cess",
    "3.1(b)",
    "osup_zero",
  ),
  "/sup_details/osup_nil_exmp/txval": gstr3bLabel(
    "Table 3.1(c) Nil-rated and exempt outward supplies — Value",
    "3.1(c)",
    "osup_nil_exmp",
  ),
  "/sup_details/isup_rev/txval": valueConfirmedLabel(
    "Table 3.1(d) Inward supplies liable to reverse charge — Taxable value",
    "3.1(d)",
  ),
  "/sup_details/isup_rev/iamt": gstr3bLabel(
    "Table 3.1(d) Inward supplies liable to reverse charge — Integrated tax",
    "3.1(d)",
    "isup_rev",
  ),
  "/sup_details/isup_rev/camt": gstr3bLabel(
    "Table 3.1(d) Inward supplies liable to reverse charge — Central tax",
    "3.1(d)",
    "isup_rev",
  ),
  "/sup_details/isup_rev/samt": gstr3bLabel(
    "Table 3.1(d) Inward supplies liable to reverse charge — State/UT tax",
    "3.1(d)",
    "isup_rev",
  ),
  "/sup_details/isup_rev/csamt": gstr3bLabel(
    "Table 3.1(d) Inward supplies liable to reverse charge — Cess",
    "3.1(d)",
    "isup_rev",
  ),
  "/sup_details/osup_nongst/txval": gstr3bLabel(
    "Table 3.1(e) Non-GST outward supplies — Value",
    "3.1(e)",
    "osup_nongst",
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/OTH",
    "Table 4(A)(5) All other ITC",
    "4(A)(5)",
    ["camt", "iamt", "samt"],
    "confirmed",
  ),
  ...componentEntries(
    "/itc_elg/itc_net",
    "Table 4(C) Net ITC available (A) − (B)",
    "4(C)",
    ["camt", "iamt", "samt"],
    "confirmed",
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/IMPG",
    "Table 4(A)(1) Import of goods",
    "4(A)(1)",
    ["camt", "iamt", "samt"],
    "vocabulary",
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/IMPS",
    "Table 4(A)(2) Import of services",
    "4(A)(2)",
    ["camt", "iamt", "samt"],
    "vocabulary",
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/ISRC",
    "Table 4(A)(3) Inward supplies liable to reverse charge (other than 1 and 2 above)",
    "4(A)(3)",
    ["camt", "iamt", "samt"],
    "vocabulary",
  ),
  ...componentEntries(
    "/itc_elg/itc_avl/ISD",
    "Table 4(A)(4) Inward supplies from ISD",
    "4(A)(4)",
    ["camt", "iamt", "samt"],
    "vocabulary",
  ),
  ...componentEntries(
    "/itc_elg/itc_rev/RUL",
    "Table 4(B)(1) ITC reversed — As per rules 38, 42 and 43 and section 17(5)",
    "4(B)(1)",
    ["camt", "iamt", "samt"],
    "vocabulary",
  ),
  ...componentEntries(
    "/itc_elg/itc_rev/OTH",
    "Table 4(B)(2) ITC reversed — Others",
    "4(B)(2)",
    ["camt", "iamt", "samt"],
    "vocabulary",
  ),
  ...componentEntries(
    "/itc_elg/itc_inelg/RUL",
    "Table 4(D)(1) Ineligible ITC — As per section 17(5)",
    "4(D)(1)",
    ["camt", "iamt", "samt"],
    "vocabulary",
  ),
  ...componentEntries(
    "/itc_elg/itc_inelg/OTH",
    "Table 4(D)(2) Ineligible ITC — Others",
    "4(D)(2)",
    ["camt", "iamt", "samt"],
    "vocabulary",
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

export function filedReturnsSummaryIdentityLabel(path: string): string | null {
  const canonicalToken = canonicalTerminalToken(path);
  if (canonicalToken === "gstin") return "GSTIN";
  if (canonicalToken === "pan" || canonicalToken === "panno" || canonicalToken === "taxpayerpan") {
    return "PAN";
  }
  if (canonicalToken === "lgnm" || canonicalToken === "legalname") return "Legal name";
  if (canonicalToken === "trdnm" || canonicalToken === "tradename") return "Trade name";
  if (
    canonicalToken === "taxpayername" ||
    canonicalToken === "taxpyrname" ||
    canonicalToken === "nameoftaxpayer"
  ) {
    return "Taxpayer name";
  }
  if (
    canonicalToken === "signatory" ||
    canonicalToken === "signatoryname" ||
    canonicalToken === "authorizedsignatory" ||
    canonicalToken === "authorisedsignatory"
  ) {
    return "Signatory";
  }
  if (canonicalToken === "designation" || canonicalToken === "desig") return "Designation";
  return null;
}

export function isFiledReturnsSummaryForbiddenFieldPath(path: string): boolean {
  return canonicalPathTokens(path).some(isForbiddenCanonicalToken);
}

function isForbiddenCanonicalToken(canonicalToken: string): boolean {
  return (
    canonicalToken === "auth" ||
    canonicalToken === "apikey" ||
    canonicalToken === "authheader" ||
    canonicalToken === "authkey" ||
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
    canonicalToken.includes("privatekey") ||
    canonicalToken.includes("saml") ||
    canonicalToken.includes("secret") ||
    canonicalToken.includes("session") ||
    canonicalToken.includes("sessid") ||
    canonicalToken === "otp" ||
    canonicalToken.endsWith("otp")
  );
}

function canonicalTerminalToken(path: string): string {
  return canonicalPathTokens(path).at(-1) ?? "";
}

function canonicalPathTokens(path: string): string[] {
  if (path === "") return [];
  return path
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

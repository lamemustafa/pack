import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export interface FiledReturnsSummaryFieldLabel {
  label: string;
  provenance: {
    officialSource: string;
    officialSourceLocation: string;
    reviewedOn: string;
  };
}

type FiledReturnsSummaryFieldLabelMap = Readonly<Record<string, FiledReturnsSummaryFieldLabel>>;

const GSTR3B_SOURCE = "GST Portal GSTR-3B Offline Utility V5.8 and Form GSTR-3B user guide";
const REVIEWED_ON = "2026-08-18";

function gstr3bLabel(
  label: string,
  table: "3.1(a)" | "3.1(b)" | "3.1(c)" | "3.1(d)" | "3.1(e)",
  jsonObject: "osup_det" | "osup_zero" | "osup_nil_exmp" | "isup_rev" | "osup_nongst",
): FiledReturnsSummaryFieldLabel {
  return {
    label,
    provenance: {
      officialSource: GSTR3B_SOURCE,
      officialSourceLocation: `Form GSTR-3B Table ${table}; offline utility JSON generator sup_details.${jsonObject}`,
      reviewedOn: REVIEWED_ON,
    },
  };
}

const GSTR3B_LABELS: FiledReturnsSummaryFieldLabelMap = {
  "/sup_details/osup_det/txval": gstr3bLabel(
    "Table 3.1(a) Outward taxable supplies — Taxable value",
    "3.1(a)",
    "osup_det",
  ),
  "/sup_details/osup_det/iamt": gstr3bLabel(
    "Table 3.1(a) Outward taxable supplies — Integrated tax",
    "3.1(a)",
    "osup_det",
  ),
  "/sup_details/osup_det/camt": gstr3bLabel(
    "Table 3.1(a) Outward taxable supplies — Central tax",
    "3.1(a)",
    "osup_det",
  ),
  "/sup_details/osup_det/samt": gstr3bLabel(
    "Table 3.1(a) Outward taxable supplies — State/UT tax",
    "3.1(a)",
    "osup_det",
  ),
  "/sup_details/osup_det/csamt": gstr3bLabel(
    "Table 3.1(a) Outward taxable supplies — Cess",
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
  "/sup_details/isup_rev/txval": gstr3bLabel(
    "Table 3.1(d) Inward supplies liable to reverse charge — Taxable value",
    "3.1(d)",
    "isup_rev",
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
  const canonicalToken = canonicalTerminalToken(path);
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
  const terminalToken = path.split("/").at(-1)?.replace(/~1/g, "/").replace(/~0/g, "~") ?? "";
  return terminalToken.toLowerCase().replace(/[^a-z0-9]/g, "");
}

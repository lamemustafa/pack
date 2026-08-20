import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import {
  compareFiledReturnsFilingPeriods,
  type FiledReturnsFilingPeriod,
} from "./filed-returns-scope";

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
  periodVersion?: FiledReturnsPeriodCaptionVersion;
}

// Current-form table boundary verified against the GST Portal Form GSTR-3B PDF and manual.
// Statement labels determine which of these tables are included; every other table is excluded.
const GSTR3B_FORM_TABLES = ["3.1", "3.1.1", "3.2", "4", "5", "5.1", "6.1"] as const;
type FiledReturnsStatementCoverageTable = (typeof GSTR3B_FORM_TABLES)[number];

export interface FiledReturnsStatementLineItem {
  coverageTable: FiledReturnsStatementCoverageTable;
  sectionCaption: string;
  sectionOrder: number;
  shortLabel: "Taxable Value" | "Value" | "IGST" | "CGST" | "SGST" | "Cess";
  subrowOrder: number;
}

interface FiledReturnsPeriodCaptionVersion {
  oldLabel: string;
  oldSectionCaption: string;
  tableReference: string;
}

interface FiledReturnsPeriodCaptionConfig {
  oldSectionCaption: string;
  tableReference: string;
}

type FiledReturnsSummaryFieldLabelMap = Readonly<Record<string, FiledReturnsSummaryFieldLabel>>;

const GSTR3B_SOURCE = "GST Portal GSTR-3B Offline Utility V5.8 and Form GSTR-3B user guide";
const GSTR3B_PDF_CROSS_CHECK_SOURCE = "GST Portal GSTR-3B PDF export and JSON schema";
const REVIEWED_ON = "2026-08-20";
const GSTR3B_OLD_CAPTION_THROUGH: FiledReturnsFilingPeriod = {
  financialYear: "2022-23",
  period: "July",
};
const GSTR3B_CURRENT_CAPTION_FROM: FiledReturnsFilingPeriod = {
  financialYear: "2025-26",
  period: "December",
};

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
  periodCaption?: FiledReturnsPeriodCaptionConfig,
): Record<string, FiledReturnsSummaryFieldLabel> {
  return Object.fromEntries(
    components.map((component) => {
      const label = `${labelPrefix} — ${COMPONENT_LABELS[component]}`;
      const entry = withOptionalStatement(
        provenance === "confirmed"
          ? valueConfirmedLabel(label, table)
          : portalPdfRowTextLabel(label, table),
        labelPrefix,
        component,
        statementCoverageTable,
        statementSectionOrder,
      );
      return [
        `${basePath}/${component}`,
        periodCaption === undefined ? entry : withPeriodCaption(entry, periodCaption, component),
      ];
    }),
  );
}

function withPeriodCaption(
  entry: FiledReturnsSummaryFieldLabel,
  config: FiledReturnsPeriodCaptionConfig,
  component: ComponentKey,
): FiledReturnsSummaryFieldLabel {
  return {
    ...entry,
    periodVersion: {
      oldLabel: `${config.oldSectionCaption} — ${COMPONENT_LABELS[component]}`,
      oldSectionCaption: config.oldSectionCaption,
      tableReference: config.tableReference,
    },
  };
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
    {
      oldSectionCaption: "Table 4(B)(1) ITC reversed — As per rules 42 & 43 of CGST Rules",
      tableReference: "Table 4(B)(1)",
    },
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
    {
      oldSectionCaption: "Table 4(D)(1) Ineligible ITC — As per section 17(5)",
      tableReference: "Table 4(D)(1)",
    },
  ),
  ...componentEntries(
    "/itc_elg/itc_inelg/OTH",
    "Table 4(D)(2) Other Details — Ineligible ITC under section 16(4) & ITC restricted due to PoS rules",
    "4(D)(2)",
    ["camt", "iamt", "samt", "csamt"],
    "portal-pdf",
    "4",
    14,
    {
      oldSectionCaption: "Table 4(D)(2) Ineligible ITC — Others",
      tableReference: "Table 4(D)(2)",
    },
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
  filingPeriod: FiledReturnsFilingPeriod,
): string {
  const entry = FILED_RETURNS_SUMMARY_FIELD_LABELS_BY_RETURN_TYPE[returnType][path];
  return entry ? selectedCaption(entry, filingPeriod).label : "";
}

export function filedReturnsStatementLineItems(
  filingPeriods: readonly FiledReturnsFilingPeriod[],
): Array<
  FiledReturnsStatementLineItem & {
    captionWithheld: boolean;
    fieldPath: string;
    tableReference?: string;
  }
> {
  return Object.entries(GSTR3B_LABELS)
    .flatMap(([fieldPath, entry]) => {
      if (!entry.statement) return [];
      const caption = selectedCaptionAcrossPeriods(entry, filingPeriods);
      return [
        {
          fieldPath,
          ...entry.statement,
          sectionCaption: caption.sectionCaption ?? entry.statement.sectionCaption,
          captionWithheld: caption.withheld,
          ...(caption.tableReference ? { tableReference: caption.tableReference } : {}),
        },
      ];
    })
    .sort(
      (left, right) =>
        left.sectionOrder - right.sectionOrder || left.subrowOrder - right.subrowOrder,
    );
}

export function filedReturnsStatementCoverage(filingPeriods: readonly FiledReturnsFilingPeriod[]): {
  includedTables: string[];
  excludedTables: string[];
  withheldCaptionTables?: string[];
} {
  const lineItems = filedReturnsStatementLineItems(filingPeriods);
  const includedTables = [...new Set(lineItems.map((lineItem) => lineItem.coverageTable))];
  const withheldCaptionTables = [
    ...new Set(
      lineItems
        .filter((lineItem) => lineItem.captionWithheld)
        .map((lineItem) => lineItem.tableReference)
        .filter((tableReference): tableReference is string => tableReference !== undefined),
    ),
  ];
  return {
    includedTables,
    excludedTables: GSTR3B_FORM_TABLES.filter((table) => !includedTables.includes(table)),
    ...(withheldCaptionTables.length > 0 ? { withheldCaptionTables } : {}),
  };
}

function selectedCaptionAcrossPeriods(
  entry: FiledReturnsSummaryFieldLabel,
  filingPeriods: readonly FiledReturnsFilingPeriod[],
): { label: string; sectionCaption?: string; tableReference?: string; withheld: boolean } {
  const captions = filingPeriods.map((filingPeriod) => selectedCaption(entry, filingPeriod));
  const firstCaption = captions[0];
  if (!firstCaption) throw new TypeError("Statement requires at least one rendered filing period.");
  if (captions.every((caption) => caption.label === firstCaption.label)) return firstCaption;
  if (!entry.periodVersion) return firstCaption;
  return {
    label: entry.periodVersion.tableReference,
    sectionCaption: entry.periodVersion.tableReference,
    tableReference: entry.periodVersion.tableReference,
    withheld: true,
  };
}

function selectedCaption(
  entry: FiledReturnsSummaryFieldLabel,
  filingPeriod: FiledReturnsFilingPeriod,
): { label: string; sectionCaption?: string; tableReference?: string; withheld: boolean } {
  if (!entry.periodVersion) return { label: entry.label, withheld: false };
  if (compareFiledReturnsFilingPeriods(filingPeriod, GSTR3B_OLD_CAPTION_THROUGH) <= 0) {
    return {
      label: entry.periodVersion.oldLabel,
      sectionCaption: entry.periodVersion.oldSectionCaption,
      withheld: false,
    };
  }
  if (compareFiledReturnsFilingPeriods(filingPeriod, GSTR3B_CURRENT_CAPTION_FROM) >= 0) {
    return { label: entry.label, withheld: false };
  }
  return {
    label: entry.periodVersion.tableReference,
    sectionCaption: entry.periodVersion.tableReference,
    tableReference: entry.periodVersion.tableReference,
    withheld: true,
  };
}

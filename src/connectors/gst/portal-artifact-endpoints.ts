export const GSTR2B_ORIGIN = "https://gstr2b.gst.gov.in";
export const GSTR2B_JSON_PATH = "/gstr2b/auth/api/gstr2b/getjson";
export const GSTR2B_SUMMARY_PATH = "/gstr2b/auth/gstr2b/summary";

export type Gstr2bPageGeneratedArtifact = "PDF" | "EXCEL";

export const GSTR2B_PAGE_GENERATED_ARTIFACTS: Record<
  Gstr2bPageGeneratedArtifact,
  { controlText: string; expectedMime: string }
> = {
  PDF: { controlText: "DOWNLOAD GSTR-2B SUMMARY (PDF)", expectedMime: "application/pdf" },
  EXCEL: {
    controlText: "DOWNLOAD GSTR-2B DETAILS (EXCEL)",
    expectedMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};

export const GSTR1_SUMMARY_PATH = "/returns/auth/gstr1/gstr1sum";
export const GSTR1_DETAIL_PATH = "/returns/auth/gstr1";
export const GSTR1_SUMMARY_PREFLIGHT_PATH = "/returns/auth/api/gstr1/summary";

export const GSTR1_PAGE_GENERATED_ARTIFACTS: Record<
  Gstr2bPageGeneratedArtifact,
  { controlText: string; expectedMime: string }
> = {
  PDF: { controlText: "DOWNLOAD SUMMARY (PDF)", expectedMime: "application/pdf" },
  EXCEL: {
    controlText: "DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)",
    expectedMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};

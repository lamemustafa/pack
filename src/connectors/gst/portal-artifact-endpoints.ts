import { getClickableElements, normaliseText } from "./filed-returns-dom";

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

export interface PageGeneratedArtifactSurface {
  path: string;
  controlText: string;
}

// Where each GSTR-1 artifact can be acquired, and what the portal calls the control there.
//
// A filed GSTR-1 PDF has two surfaces, not one. The summary page offers `DOWNLOAD SUMMARY (PDF)`;
// the detail route offers `DOWNLOAD FILED (PDF)` -- captured live on 2026-09-10 on a period whose
// page had no route to the summary page at all, which left the flow demanding a page it could not
// reach. Listing both here keeps that fact in one place instead of in a path check and a label
// check that can disagree.
export const GSTR1_PAGE_GENERATED_ARTIFACTS: Record<
  Gstr2bPageGeneratedArtifact,
  { surfaces: readonly PageGeneratedArtifactSurface[]; expectedMime: string }
> = {
  PDF: {
    surfaces: [
      { path: GSTR1_SUMMARY_PATH, controlText: "DOWNLOAD SUMMARY (PDF)" },
      { path: GSTR1_DETAIL_PATH, controlText: "DOWNLOAD FILED (PDF)" },
    ],
    expectedMime: "application/pdf",
  },
  EXCEL: {
    surfaces: [
      { path: GSTR1_DETAIL_PATH, controlText: "DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)" },
    ],
    expectedMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};

/**
 * The controls on this page that a descriptor's `controlText` names, and that can be clicked.
 *
 * A leaf clickable whose text carries the label -- not any element mentioning it. Whether a page
 * offers an artifact is a question about controls, and answering it from page text lets decoy or
 * non-actionable copy stand in for a button. It lives beside the descriptor so that the label and
 * the search for it cannot drift apart.
 */
export function findPageArtifactControls(
  documentRef: Document,
  canonicalLabel: string,
): HTMLElement[] {
  const normalisedLabel = normaliseText(canonicalLabel);
  return getClickableElements(documentRef).filter(
    (element) =>
      getClickableElements(element).length === 0 &&
      normaliseText(element.textContent || "").includes(normalisedLabel),
  );
}

/** Whether the filed GSTR-1 detail route is itself offering the filed PDF, as captured live. */
export function offersFiledGstr1DetailPdf(documentRef: Document): boolean {
  const surface = GSTR1_PAGE_GENERATED_ARTIFACTS.PDF.surfaces.find(
    (candidate) => candidate.path === GSTR1_DETAIL_PATH,
  );
  return surface ? findPageArtifactControls(documentRef, surface.controlText).length > 0 : false;
}

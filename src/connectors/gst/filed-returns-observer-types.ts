import type { PortalObservation } from "../../core/contracts";

export type FiledReturnsObservationState =
  | "ready"
  | "filters-required"
  | "filed-return-results-visible"
  | "detail-summary-modal-open"
  | "login-required"
  | "wrong-page"
  | "page-settling"
  | "gstr-3b-not-visible"
  | "download-not-visible";

export type FiledReturnsObservation = PortalObservation & {
  scopeId:
    | "gst-filed-returns-gstr3b-pdf-private-v0"
    | "gst-filed-returns-gstr1-pdf-private-v0"
    | "gst-gstr2b-private-v0";
  state: FiledReturnsObservationState;
  pageKind: "gst-filed-returns";
};

export interface FiledReturnsObservationHints {
  pathname?: string;
  requestPathShapes?: readonly string[];
}

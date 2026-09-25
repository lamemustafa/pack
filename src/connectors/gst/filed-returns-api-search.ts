import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "./filed-returns-contracts";
import {
  extractFiledReturnsApiRows,
  readFiledReturnRowValue,
  rowMatchesScope,
  type FiledReturnsApiRow,
} from "./filed-returns-api-rows";
import { isFiledReturnsQuarterEndMonth } from "./filed-returns-months";
import { filedReturnDescriptor } from "./filed-returns-return-descriptors";
import { toPortalReturnPeriod } from "./filed-returns-return-period";
import {
  createFiledReturnsAcquisitionDeadline,
  hasFiledReturnsAcquisitionDeadlineExpired,
  remainingFiledReturnsAcquisitionTime,
} from "./filed-returns-acquisition-deadline";

const EFILED_RETURNS_API_PATH = "/returns/auth/api/efiledReturns";
const ROLE_STATUS_API_PATH = "/returns/auth/api/rolestatus";
const GSTR3B_QUARTERLY_ENABLE_PERIOD = "012021";
const FILED_RETURNS_NO_RECORD_ERROR_CODE = "RET13510";

type OpenResultResponse =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "deadline-expired"
        | "role-status-unavailable"
        | "portal-storage-unavailable"
        | "quarterly-filer";
    };

type RoleStatusResponse =
  { ok: true; userPref: string } | { ok: false; reason?: "deadline-expired" };

export async function openFiledReturnFromApiSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  deadline = createFiledReturnsAcquisitionDeadline(),
): Promise<PortalFlowStepResult | null> {
  if (scope.returnType !== "GSTR-3B") return null;
  if (!canUseFiledReturnsApi(documentRef)) return null;
  if (hasFiledReturnsAcquisitionDeadlineExpired(deadline)) return null;

  const rows = await queryFiledReturnsApi(documentRef, scope, deadline);
  if (!rows) return null;

  const descriptor = filedReturnDescriptor(scope.returnType);
  // The portal's own answer to the exact year, month and return type Pack just asked about. The page
  // shows the same message without any DOM change when searched again, so page-based evidence cannot
  // prove a repeat "no record" is fresh; this answer is bound to the request itself (2026-09-21).
  if (rows === "no-record") {
    // A quarterly filer has no GSTR-3B for the first two months of a quarter, so "no record" there is
    // not a missed filing. The role status answers per period; only its explicit "Q" changes the
    // reading, and an unavailable answer keeps the not-filed reading Pack gave before it asked.
    if (await isQuarterlyFilerPeriod(documentRef, scope, deadline)) {
      return quarterlyFilerNoRecordAnswer(scope, scopeId);
    }
    return {
      connectorId: "gst",
      scopeId,
      state: "candidate-not-found",
      safeSignals: ["filed-return-api-searched", "filed-return-positively-not-filed"],
      safeMessage: `The GST Portal reported no filed ${descriptor.label} for ${scope.period} ${scope.financialYear}.`,
    };
  }
  const matchingRows = rows.filter((row) => rowMatchesScope(row, scope));
  if (matchingRows.length === 0) {
    return null;
  }

  if (matchingRows.length > 1) {
    return {
      connectorId: "gst",
      scopeId,
      state: "blocked",
      safeSignals: ["filed-return-api-searched", "filed-return-api-result-ambiguous"],
      safeMessage: `Pack found more than one GST filed-return API result for the requested ${descriptor.label} period. Open the correct row manually, then start Pack again.`,
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: `Open the exact filed ${descriptor.label} row for the requested period.`,
        canResume: true,
      },
    };
  }

  const matchingRow = matchingRows[0];
  if (!matchingRow) return null;

  const openResponse = await openApiRowWithPortalNavigation(
    documentRef,
    matchingRow,
    scope,
    deadline,
  );
  if (!openResponse.ok && openResponse.reason === "quarterly-filer") {
    return quarterlyFilerStop(scope, scopeId);
  }
  if (openResponse.ok) {
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [
        "filed-return-api-searched",
        "filed-return-api-result-found",
        "filed-return-api-result-posted",
        `filed-return-result-period:${scope.period}`,
      ],
      safeMessage: `Pack found the filed ${descriptor.label} through the GST search API and opened the portal detail page.`,
    };
  }

  return {
    connectorId: "gst",
    scopeId,
    state: "blocked",
    safeSignals: [
      "filed-return-api-searched",
      "filed-return-api-result-found",
      `filed-return-api-result-${openResponse.reason}`,
    ],
    safeMessage: `Pack found the filed ${descriptor.label} through the GST search API, but the portal detail-page handoff could not be completed safely. Open the row manually, then start Pack again.`,
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: `Open the exact filed ${descriptor.label} row for the requested period.`,
      canResume: true,
    },
  };
}

/**
 * The quarterly reading of a "no record" the page reports itself: the same answer, reached without the
 * filed-return search, so it asks the same per-period question before it can mean "not filed".
 */
export async function quarterlyFilerAnswerForPeriod(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  deadline = createFiledReturnsAcquisitionDeadline(),
): Promise<PortalFlowStepResult | null> {
  if (scope.returnType !== "GSTR-3B" || !canUseFiledReturnsApi(documentRef)) return null;
  return (await isQuarterlyFilerPeriod(documentRef, scope, deadline))
    ? quarterlyFilerNoRecordAnswer(scope, scopeId)
    : null;
}

/**
 * "No record" for a month the role status names quarterly. Months 1-2 of a quarter have no GSTR-3B
 * at all -- the quarter's return is filed for its last month -- so that is a settled answer. What a
 * quarter-end "no record" means for a quarterly filer is not captured yet, so it keeps the stop.
 */
function quarterlyFilerNoRecordAnswer(
  scope: FiledReturnsDownloadScope,
  scopeId: string,
): PortalFlowStepResult {
  if (isFiledReturnsQuarterEndMonth(scope.period)) return quarterlyFilerStop(scope, scopeId);
  return {
    connectorId: "gst",
    scopeId,
    state: "candidate-not-found",
    safeSignals: ["filed-return-api-searched", "filed-gstr3b-quarterly-no-monthly-return"],
    safeMessage: `The GST Portal shows this taxpayer files GSTR-3B quarterly (QRMP) for ${scope.period} ${scope.financialYear}, so there is no monthly GSTR-3B for it; the quarter's return is filed for the quarter's last month.`,
  };
}

async function isQuarterlyFilerPeriod(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  deadline: number,
): Promise<boolean> {
  const rtnPrd = toPortalReturnPeriod(scope.period, scope.financialYear);
  if (!rtnPrd) return false;
  const roleStatus = await queryRoleStatus(documentRef, rtnPrd, deadline);
  return roleStatus.ok && roleStatus.userPref === "Q";
}

function quarterlyFilerStop(
  scope: FiledReturnsDownloadScope,
  scopeId: string,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId,
    state: "blocked",
    safeSignals: ["filed-return-api-searched", "filed-gstr3b-quarterly-filer-unsupported"],
    safeMessage: `The GST Portal shows this taxpayer files GSTR-3B quarterly (QRMP) for ${scope.period} ${scope.financialYear}. Pack supports monthly filers only; download quarterly returns from the GST Portal.`,
  };
}

function canUseFiledReturnsApi(documentRef: Document): boolean {
  const location = documentRef.defaultView?.location;
  return location?.origin === "https://return.gst.gov.in";
}

async function queryFiledReturnsApi(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  deadline: number,
): Promise<FiledReturnsApiRow[] | "no-record" | null> {
  try {
    const response = await fetchBeforeDeadline(
      documentRef,
      EFILED_RETURNS_API_PATH,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify({
          fy: scope.financialYear,
          rfp: "Monthly",
          qtr: null,
          mth: scope.period,
          rtntp: normaliseReturnTypeForApi(scope.returnType),
        }),
      },
      deadline,
    );
    // Read the body before the status: the portal's explicit "no record" answer may arrive with
    // either, and it is the one error that is itself an answer rather than a failure.
    const payload: unknown = await response.json().catch(() => null);
    if (hasFiledReturnsAcquisitionDeadlineExpired(deadline)) return null;
    // A no-record code beside a data array is ambiguous: it answers nothing, so never "not filed".
    if (isNoRecordAnswer(payload)) {
      return extractFiledReturnsApiRows(payload) === null ? "no-record" : null;
    }
    if (!response.ok) return null;
    return extractFiledReturnsApiRows(payload);
  } catch {
    return null;
  }
}

async function openApiRowWithPortalNavigation(
  documentRef: Document,
  row: FiledReturnsApiRow,
  scope: FiledReturnsDownloadScope,
  deadline: number,
): Promise<OpenResultResponse> {
  if (hasFiledReturnsAcquisitionDeadlineExpired(deadline)) {
    return { ok: false, reason: "deadline-expired" };
  }
  const view = documentRef.defaultView;
  if (!view) return { ok: false, reason: "portal-storage-unavailable" };

  const rtnPrd = toPortalReturnPeriod(
    readFiledReturnRowValue(row, ["taxp", "taxPeriod", "retPeriod", "period"]),
    readFiledReturnRowValue(row, ["fy", "finYear", "financialYear"]),
  );
  if (!rtnPrd) return { ok: false, reason: "portal-storage-unavailable" };
  const roleStatus = await queryRoleStatus(documentRef, rtnPrd, deadline);
  if (!roleStatus.ok) {
    return roleStatus.reason === "deadline-expired"
      ? { ok: false, reason: "deadline-expired" }
      : { ok: false, reason: "role-status-unavailable" };
  }

  // The quarterly (GSTR-3BQ) page this would open shows the quarter, not the month, and has no
  // download Pack can bind to the requested period yet.
  if (roleStatus.userPref === "Q") return { ok: false, reason: "quarterly-filer" };

  try {
    if (hasFiledReturnsAcquisitionDeadlineExpired(deadline)) {
      return { ok: false, reason: "deadline-expired" };
    }
    writePortalFiledReturnState(view, scope, rtnPrd, roleStatus.userPref);
    if (hasFiledReturnsAcquisitionDeadlineExpired(deadline)) {
      return { ok: false, reason: "deadline-expired" };
    }
    submitPortalGstr3bForm(documentRef, rtnPrd);
    return { ok: true };
  } catch {
    return { ok: false, reason: "portal-storage-unavailable" };
  }
}

async function queryRoleStatus(
  documentRef: Document,
  rtnPrd: string,
  deadline: number,
): Promise<RoleStatusResponse> {
  if (hasFiledReturnsAcquisitionDeadlineExpired(deadline)) {
    return { ok: false, reason: "deadline-expired" };
  }

  try {
    const response = await fetchBeforeDeadline(
      documentRef,
      `${ROLE_STATUS_API_PATH}?rtn_prd=${encodeURIComponent(rtnPrd)}`,
      {
        credentials: "same-origin",
        headers: {
          Accept: "application/json, text/plain, */*",
        },
      },
      deadline,
    );
    if (!response.ok) return { ok: false };

    const payload: unknown = await response.json();
    if (hasFiledReturnsAcquisitionDeadlineExpired(deadline)) {
      return { ok: false, reason: "deadline-expired" };
    }
    const userPref = readUserPreference(payload);
    if (!userPref) {
      if (!isGstr3bQuarterlyEnabled(rtnPrd)) return { ok: true, userPref: "M" };
      return { ok: false };
    }
    return { ok: true, userPref };
  } catch {
    return { ok: false };
  }
}

async function fetchBeforeDeadline(
  documentRef: Document,
  input: RequestInfo | URL,
  init: RequestInit,
  deadline: number,
): Promise<Response> {
  const view = documentRef.defaultView;
  const fetchFn = view?.fetch;
  if (!fetchFn || hasFiledReturnsAcquisitionDeadlineExpired(deadline)) {
    throw new Error("filed-returns-acquisition-deadline-expired");
  }
  const Controller = view?.AbortController ?? AbortController;
  const controller = new Controller();
  const timeout = setTimeout(
    () => controller.abort(),
    remainingFiledReturnsAcquisitionTime(deadline),
  );
  try {
    const response = await fetchFn(input, { ...init, signal: controller.signal });
    if (hasFiledReturnsAcquisitionDeadlineExpired(deadline)) {
      throw new Error("filed-returns-acquisition-deadline-expired");
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function writePortalFiledReturnState(
  view: Window,
  scope: FiledReturnsDownloadScope,
  rtnPrd: string,
  userPref: string,
) {
  const filingYear = Number(rtnPrd.slice(2));
  const enableGstr3bQuarterly = isGstr3bQuarterlyEnabled(rtnPrd);
  const pref = enableGstr3bQuarterly && userPref === "Q" ? "Q" : "M";
  const efileData = {
    gstin: "",
    arn: "",
    Month: scope.period,
    fy: scope.financialYear,
    Duedt: "",
    status: "FIL",
    finYear: rtnPrd,
    dtFile: "",
    userPref,
  };

  view.sessionStorage.setItem("viewFiled", "true");
  view.sessionStorage.setItem("showTO", filingYear >= 2022 ? "true" : "false");
  view.localStorage.setItem("efile_data", JSON.stringify(efileData));
  view.localStorage.setItem("BCK_FLAG", "E");
  view.localStorage.setItem("rtn_prd", rtnPrd);
  view.localStorage.setItem("enableGstr3bQuarterly", String(enableGstr3bQuarterly));
  view.localStorage.setItem("GSTR3b_Info", "Y");
  view.localStorage.setItem("uPref", userPref);
  view.localStorage.setItem("gstr3bPref", pref);
}

function submitPortalGstr3bForm(documentRef: Document, rtnPrd: string) {
  const form = documentRef.createElement("form");
  form.method = "POST";
  form.action = "/returns/auth/gstr3b";
  form.style.display = "none";

  const input = documentRef.createElement("input");
  input.type = "hidden";
  input.name = "RTN_PRD";
  input.value = rtnPrd;
  form.append(input);

  documentRef.body.append(form);
  form.submit();
}

function isGstr3bQuarterlyEnabled(rtnPrd: string): boolean {
  const thresholdMonth = Number(GSTR3B_QUARTERLY_ENABLE_PERIOD.slice(0, 2)) - 1;
  const thresholdYear = Number(GSTR3B_QUARTERLY_ENABLE_PERIOD.slice(2));
  const returnMonth = Number(rtnPrd.slice(0, 2)) - 1;
  const returnYear = Number(rtnPrd.slice(2));
  return new Date(returnYear, returnMonth) >= new Date(thresholdYear, thresholdMonth);
}

function readUserPreference(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const direct = (payload as { userPref?: unknown }).userPref;
    if (isAcceptedUserPreference(direct)) return direct;
    const data = (payload as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const nested = (data as { userPref?: unknown }).userPref;
      if (isAcceptedUserPreference(nested)) return nested;
    }
  }
  return null;
}

function isAcceptedUserPreference(value: unknown): value is string {
  return value === "M" || value === "Q";
}

/** RET13510, "No Record found for the provided Inputs": the portal's answer that nothing is filed. */
function isNoRecordAnswer(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  // The live portal answers HTTP 200 with the code one level down: `{status, error: {errorCode}}`
  // (probed 2026-09-21). The top-level form is accepted as well; nothing else is.
  const { errorCode, error } = payload as { errorCode?: unknown; error?: unknown };
  const nestedCode =
    typeof error === "object" && error !== null
      ? (error as { errorCode?: unknown }).errorCode
      : undefined;
  return (
    errorCode === FILED_RETURNS_NO_RECORD_ERROR_CODE ||
    nestedCode === FILED_RETURNS_NO_RECORD_ERROR_CODE
  );
}

function normaliseReturnTypeForApi(returnType: FiledReturnsDownloadScope["returnType"]): string {
  return returnType.replace(/-/g, "");
}

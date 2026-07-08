import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  extractFiledReturnsApiRows,
  readFiledReturnRowValue,
  rowMatchesScope,
  type FiledReturnsApiRow,
} from "./filed-returns-api-rows";
import { filedReturnDescriptor } from "./filed-returns-return-descriptors";
import { toPortalReturnPeriod } from "./filed-returns-return-period";

const EFILED_RETURNS_API_PATH = "/returns/auth/api/efiledReturns";
const ROLE_STATUS_API_PATH = "/returns/auth/api/rolestatus";
const GSTR3B_QUARTERLY_ENABLE_PERIOD = "012021";

type OpenResultResponse =
  | { ok: true }
  | { ok: false; reason: "role-status-unavailable" | "portal-storage-unavailable" };

export async function openFiledReturnFromApiSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
): Promise<PortalFlowStepResult | null> {
  if (scope.returnType !== "GSTR-3B") return null;
  if (!canUseFiledReturnsApi(documentRef)) return null;

  const rows = await queryFiledReturnsApi(documentRef, scope);
  if (!rows) return null;

  const descriptor = filedReturnDescriptor(scope.returnType);
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

  const openResponse = await openApiRowWithPortalNavigation(documentRef, matchingRow, scope);
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
    state: "user-action-required",
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

function canUseFiledReturnsApi(documentRef: Document): boolean {
  const location = documentRef.defaultView?.location;
  return (
    location?.origin === "https://return.gst.gov.in" &&
    location.pathname.toLowerCase() === "/returns/auth/efiledreturns"
  );
}

async function queryFiledReturnsApi(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Promise<FiledReturnsApiRow[] | null> {
  const fetchFn = documentRef.defaultView?.fetch;
  if (!fetchFn) return null;

  try {
    const response = await fetchFn(EFILED_RETURNS_API_PATH, {
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
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    return extractFiledReturnsApiRows(payload);
  } catch {
    return null;
  }
}

async function openApiRowWithPortalNavigation(
  documentRef: Document,
  row: FiledReturnsApiRow,
  scope: FiledReturnsDownloadScope,
): Promise<OpenResultResponse> {
  const view = documentRef.defaultView;
  if (!view) return { ok: false, reason: "portal-storage-unavailable" };

  const rtnPrd = toPortalReturnPeriod(
    readFiledReturnRowValue(row, ["taxp", "taxPeriod", "retPeriod", "period"]),
    readFiledReturnRowValue(row, ["fy", "finYear", "financialYear"]),
  );
  if (!rtnPrd) return { ok: false, reason: "portal-storage-unavailable" };
  const roleStatus = await queryRoleStatus(documentRef, rtnPrd);
  if (!roleStatus.ok) return { ok: false, reason: "role-status-unavailable" };

  try {
    writePortalFiledReturnState(view, scope, rtnPrd, roleStatus.userPref);
    submitPortalGstr3bForm(documentRef, rtnPrd);
    return { ok: true };
  } catch {
    return { ok: false, reason: "portal-storage-unavailable" };
  }
}

async function queryRoleStatus(
  documentRef: Document,
  rtnPrd: string,
): Promise<{ ok: true; userPref: string } | { ok: false }> {
  const fetchFn = documentRef.defaultView?.fetch;
  if (!fetchFn) return { ok: false };

  try {
    const response = await fetchFn(
      `${ROLE_STATUS_API_PATH}?rtn_prd=${encodeURIComponent(rtnPrd)}`,
      {
        credentials: "same-origin",
        headers: {
          Accept: "application/json, text/plain, */*",
        },
      },
    );
    if (!response.ok) return { ok: false };

    const payload: unknown = await response.json();
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

function normaliseReturnTypeForApi(returnType: FiledReturnsDownloadScope["returnType"]): string {
  return returnType.replace(/-/g, "");
}

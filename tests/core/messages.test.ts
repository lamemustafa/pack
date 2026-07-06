import { describe, expect, it } from "vitest";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import { isPackMessage } from "../../src/core/messages";

describe("message boundary", () => {
  it("accepts only known Pack messages", () => {
    expect(isPackMessage({ type: "PACK_GET_CONTEXT" })).toBe(true);
    expect(isPackMessage({ type: "PACK_START_SYNTHETIC_DEMO" })).toBe(true);
    expect(isPackMessage({ type: "PACK_CONTENT_CONTEXT", payload: { supported: false } })).toBe(
      true,
    );
    expect(
      isPackMessage({
        type: "PACK_FILED_RETURNS_OBSERVATION",
        payload: {
          connectorId: "gst",
          pageKind: "gst-filed-returns",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "ready",
          safeSignals: ["filed-returns-heading", "gstr-3b"],
          safeMessage: "Ready",
        },
      }),
    ).toBe(true);
    expect(isPackMessage({ type: "PACK_GET_FILED_RETURNS_OBSERVATION" })).toBe(true);
    expect(isPackMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" })).toBe(true);
    expect(isPackMessage({ type: "PACK_GET_ACTIVE_FILED_RETURNS_RUN" })).toBe(true);
    expect(isPackMessage({ type: "PACK_ACKNOWLEDGE_INTERRUPTED_RUN" })).toBe(true);
    expect(isPackMessage({ type: "PACK_PING" })).toBe(true);
    expect(isPackMessage({ type: "PACK_CONTENT_PING_V2" })).toBe(true);
    expect(isPackMessage({ type: "PACK_REFRESH_FILED_RETURNS_OBSERVATION" })).toBe(true);
    expect(isPackMessage({ type: "PACK_NAVIGATE_FILED_RETURNS" })).toBe(true);
    expect(isPackMessage({ type: "PACK_CONTENT_REFRESH_FILED_RETURNS_OBSERVATION_V3" })).toBe(true);
    expect(isPackMessage({ type: "PACK_CONTENT_NAVIGATE_FILED_RETURNS_V3" })).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD",
        payload: {
          actionId: "action-1",
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
        payload: {
          actionId: "action-1",
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(true);
    expect(isPackMessage({ type: "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD" })).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD",
        payload: {
          actionId: "action-1",
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-1",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          financialYear: "2017-18",
          period: "July",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP",
        payload: {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
        payload: {
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_RETRY_FILED_RETURNS_TARGET",
        payload: {
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_RESOLVE_UNCONFIRMED_DOWNLOAD",
        payload: {
          resolution: "downloaded",
          scope: {
            financialYear: "2025-26",
            period: "March",
            returnType: "GSTR-3B",
          },
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_RESOLVE_UNCONFIRMED_DOWNLOAD",
        payload: {
          resolution: "delete-everything",
          scope: {
            financialYear: "2025-26",
            period: "March",
            returnType: "GSTR-3B",
          },
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_RETRY_FULL_FISCAL_YEAR_TARGET",
        payload: {
          ledgerId: "ledger-existing",
          targetId: "GSTR-3B:2026-27:April",
          expectedRevision: 2,
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_RESOLVE_FULL_FISCAL_YEAR_TARGET",
        payload: {
          ledgerId: "ledger-existing",
          targetId: "GSTR-3B:2026-27:April",
          expectedRevision: 2,
          resolution: "manually-observed",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_RESOLVE_FULL_FISCAL_YEAR_TARGET",
        payload: {
          ledgerId: "ledger-existing",
          targetId: "GSTR-3B:2026-27:April",
          expectedRevision: 2,
          resolution: "downloaded",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD",
        payload: {
          actionId: "action-1",
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          financialYear: "2017-18",
          period: "June",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          financialYear: "2016-17",
          period: "ALL",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          financialYear: "2025-26",
          period: "ALL",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-1",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-2B",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
        payload: {
          actionId: "action-1",
          artifactType: "EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-2B",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          artifactType: "EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
        payload: {
          actionId: "action-1",
          artifactType: "EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
        payload: {
          actionId: "action-1",
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-1",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-1",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_FILED_RETURNS_REQUEST_SHAPES",
        payload: [
          {
            connectorId: "gst",
            origin: "https://services.gst.gov.in",
            pathShape: "/services/api/returns/filed",
            initiatorType: "fetch",
          },
        ],
      }),
    ).toBe(false);
    expect(isPackMessage({ type: "PACK_GET_FILED_RETURNS_REQUEST_SHAPES" })).toBe(false);
    expect(isPackMessage({ type: "PACK_RUN_SELECTOR", selector: "input[type=password]" })).toBe(
      false,
    );
    expect(
      isPackMessage({
        type: "PACK_FILED_RETURNS_OBSERVATION",
        payload: "<html>raw portal page</html>",
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_FILED_RETURNS_REQUEST_SHAPES",
        payload: [{ url: "https://services.gst.gov.in/raw?token=secret" }],
      }),
    ).toBe(false);
    expect(isPackMessage(null)).toBe(false);
  });
});

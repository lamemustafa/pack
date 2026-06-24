import { describe, expect, it } from "vitest";
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
    expect(isPackMessage({ type: "PACK_PING" })).toBe(true);
    expect(isPackMessage({ type: "PACK_REFRESH_FILED_RETURNS_OBSERVATION" })).toBe(true);
    expect(isPackMessage({ type: "PACK_NAVIGATE_FILED_RETURNS" })).toBe(true);
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
    ).toBe(false);
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
    ).toBe(false);
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

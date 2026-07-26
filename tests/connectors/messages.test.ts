import { describe, expect, it } from "vitest";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { isPackMessage } from "../../src/connectors/gst/messages";
import { GST_CONNECTOR_DESCRIPTOR } from "../../src/connectors/gst/constants";
import { parseCanonicalFiledReturnsObservation } from "../../src/background/filed-returns-observation-state";
import { parseCanonicalGstPortalContext } from "../../src/background/gst-context-state";

const GST_SERVICES_ORIGIN = reviewedGstOrigin("//services.");
const GST_PAYLOAD_VALIDATORS = {
  portalContext: (input: unknown) =>
    parseCanonicalGstPortalContext(input, `${GST_SERVICES_ORIGIN}/services/auth/dashboard`) !==
    null,
  portalObservation: (input: unknown) => parseCanonicalFiledReturnsObservation(input) !== null,
};

describe("message boundary", () => {
  it("accepts only known Pack messages", () => {
    expect(isPackMessage({ type: "PACK_GET_CONTEXT" })).toBe(true);
    expect(isPackMessage({ type: "PACK_START_SYNTHETIC_DEMO" })).toBe(true);
    expect(isPackMessage({ type: "PACK_RUN_DOWNLOAD_PROMPT_PROBE" })).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_RUN_DOWNLOAD_PROMPT_PROBE",
        payload: { sourceClass: "offscreen-blob-url" },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_RUN_DOWNLOAD_PROMPT_PROBE",
        payload: { sourceClass: "portal-url" },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_START_SYNTHETIC_DEMO",
        payload: { downloadArtifacts: false },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_START_SYNTHETIC_DEMO",
        payload: { downloadArtifacts: "false" },
      }),
    ).toBe(false);
    expect(
      isPackMessage(
        {
          type: "PACK_CONTENT_CONTEXT",
          payload: {
            connectorId: "gst",
            supported: true,
            origin: GST_SERVICES_ORIGIN,
            pageKind: "gst-filed-returns",
          },
        },
        GST_PAYLOAD_VALIDATORS,
      ),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_CONTENT_CONTEXT",
        payload: {
          connectorId: "gst",
          supported: true,
          origin: "https://a:b@example.test",
          pageKind: "gst-filed-returns",
        },
      }),
    ).toBe(false);
    expect(isPackMessage({ type: "PACK_CONTENT_CONTEXT", payload: { supported: false } })).toBe(
      false,
    );
    expect(
      isPackMessage({
        type: "PACK_CONTENT_CONTEXT",
        payload: {
          connectorId: "gst",
          supported: true,
          origin: GST_SERVICES_ORIGIN,
          pageKind: "gst-filed-returns",
          safeTitle: "synthetic taxpayer title must not cross the boundary",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage(
        {
          type: "PACK_FILED_RETURNS_OBSERVATION",
          payload: {
            connectorId: "gst",
            pageKind: "gst-filed-returns",
            scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
            state: "ready",
            safeSignals: [
              "gstr-3b-detail-route",
              "filed-returns-heading",
              "gstr-3b",
              "download-filed-gstr-3b",
              "filed-return-download-ready",
              "filed-gstr3b-download-ready",
            ],
            safeMessage: "Ready",
          },
        },
        GST_PAYLOAD_VALIDATORS,
      ),
    ).toBe(true);
    expect(isPackMessage({ type: "PACK_GET_FILED_RETURNS_OBSERVATION" })).toBe(true);
    expect(isPackMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" })).toBe(true);
    expect(isPackMessage({ type: "PACK_GET_ACTIVE_FILED_RETURNS_RUN" })).toBe(true);
    expect(isPackMessage({ type: "PACK_ACKNOWLEDGE_INTERRUPTED_RUN" })).toBe(true);
    expect(isPackMessage({ type: "PACK_PING" })).toBe(true);
    expect(isPackMessage({ type: "PACK_CONTENT_PING_V2" })).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_CONTENT_PING_V2",
        payload: { sourceClass: "data-url" },
      }),
    ).toBe(false);
    expect(isPackMessage({ type: "PACK_CONTENT_REFRESH_CONTEXT_V3" })).toBe(true);
    expect(isPackMessage({ type: "PACK_REFRESH_FILED_RETURNS_OBSERVATION" })).toBe(true);
    expect(isPackMessage({ type: "PACK_NAVIGATE_FILED_RETURNS" })).toBe(true);
    expect(isPackMessage({ type: "PACK_CONTENT_REFRESH_FILED_RETURNS_OBSERVATION_V3" })).toBe(true);
    expect(isPackMessage({ type: "PACK_CONTENT_NAVIGATE_FILED_RETURNS_V3" })).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3",
        payload: {
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_CONTENT_CLEAR_FILED_RETURNS_SEARCH_PENDING_V3",
        payload: {
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(true);
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
    expect(
      isPackMessage({
        type: "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3",
        payload: {
          actionId: "action-1",
          artifactType: "EXCEL",
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-1",
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
          period: "May",
          returnType: "GSTR-1",
          taxpayerName: "synthetic forbidden field",
        },
      }),
    ).toBe(false);
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
          resolution: "manually-observed",
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
          resolution: "downloaded",
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
        type: "PACK_RETRY_FULL_FISCAL_YEAR_TARGET",
        payload: {
          ledgerId: "ledger-existing",
          targetId: "GSTR-3B:2026-27:April",
          expectedRevision: 2,
          portalUrl: GST_SERVICES_ORIGIN,
        },
      }),
    ).toBe(false);
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
    expect(isPackMessage({ type: "PACK_GET_CONTEXT", unexpected: true })).toBe(false);
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
        payload: [{ url: gstServicesUrl("/raw", { token: "secret" }) }],
      }),
    ).toBe(false);
    expect(isPackMessage(null)).toBe(false);
  });
});

function gstServicesUrl(pathname: string, searchParams: Record<string, string> = {}): string {
  const url = new URL(pathname, GST_SERVICES_ORIGIN);
  for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, value);
  return url.href;
}

function reviewedGstOrigin(marker: string): string {
  const origin = GST_CONNECTOR_DESCRIPTOR.supportedOrigins.find((candidate) =>
    candidate.includes(marker),
  );
  if (!origin) throw new Error("Expected the reviewed GST test origin.");
  return origin;
}

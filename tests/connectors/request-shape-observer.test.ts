import { describe, expect, it } from "vitest";
import { createSafeRequestShapes } from "../../src/connectors/gst/request-shape-observer";

describe("GST request-shape observer", () => {
  it("keeps only redacted same-origin request shapes", () => {
    const supportedOrigin = "https://services.gst.gov.in";
    const opaqueSegment = "synthetic-opaque-segment-0001";
    const shapes = createSafeRequestShapes(
      [
        {
          name: `${supportedOrigin}/services/api/returns/${opaqueSegment}/filed`,
          initiatorType: "fetch",
          startTime: 10,
        },
        {
          name: `${supportedOrigin}/services/api/returns/${opaqueSegment}/filed`,
          initiatorType: "fetch",
          startTime: 11,
        },
        {
          name: "https://example.com/tracker.js",
          initiatorType: "script",
          startTime: 20,
        },
      ],
      supportedOrigin,
    );

    expect(shapes).toEqual([
      {
        connectorId: "gst",
        origin: "https://services.gst.gov.in",
        pathShape: "/services/api/returns/[opaque]/filed",
        initiatorType: "fetch",
      },
    ]);
    expect(JSON.stringify(shapes)).not.toContain(opaqueSegment);
  });

  it("redacts long opaque path tokens", () => {
    const supportedOrigin = "https://return.gst.gov.in";
    const syntheticDocumentSegment = "synthetic-document-segment-0002";
    const shapes = createSafeRequestShapes(
      [
        {
          name: `${supportedOrigin}/returns/auth/api/download/${syntheticDocumentSegment}`,
          initiatorType: "xmlhttprequest",
          startTime: 5,
        },
      ],
      supportedOrigin,
    );

    expect(shapes[0]?.pathShape).toBe("/returns/auth/api/download/[opaque]");
    expect(JSON.stringify(shapes)).not.toContain(syntheticDocumentSegment);
  });

  it("deduplicates stable request shapes", () => {
    const shapes = createSafeRequestShapes(
      [
        {
          name: "https://services.gst.gov.in/services/api/returns/filed",
          initiatorType: "fetch",
          startTime: 1,
        },
        {
          name: "https://services.gst.gov.in/services/api/returns/filed",
          initiatorType: "fetch",
          startTime: 2,
        },
      ],
      "https://services.gst.gov.in",
    );

    expect(shapes).toHaveLength(1);
  });
});

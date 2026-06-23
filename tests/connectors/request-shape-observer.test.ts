import { describe, expect, it } from "vitest";
import { createSafeRequestShapes } from "../../src/connectors/gst/request-shape-observer";

describe("GST request-shape observer", () => {
  it("keeps only redacted same-origin request shapes", () => {
    const shapes = createSafeRequestShapes(
      [
        {
          name: "https://services.gst.gov.in/services/api/returns/29ABCDE1234F1Z5/filed?token=secret#hash",
          initiatorType: "fetch",
          startTime: 10,
        },
        {
          name: "https://example.com/tracker.js",
          initiatorType: "script",
          startTime: 20,
        },
      ],
      "https://services.gst.gov.in",
    );

    expect(shapes).toEqual([
      {
        connectorId: "gst",
        origin: "https://services.gst.gov.in",
        pathShape: "/services/api/returns/[opaque]/filed",
        initiatorType: "fetch",
      },
    ]);
    expect(JSON.stringify(shapes)).not.toMatch(/token|29ABCDE1234F1Z5|secret/);
  });

  it("redacts long opaque path tokens", () => {
    const shapes = createSafeRequestShapes(
      [
        {
          name: "https://return.gst.gov.in/returns/auth/api/download/a1b2c3d4e5f6g7h8i9j0",
          initiatorType: "xmlhttprequest",
          startTime: 5,
        },
      ],
      "https://return.gst.gov.in",
    );

    expect(shapes[0]?.pathShape).toBe("/returns/auth/api/download/[opaque]");
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

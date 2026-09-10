import { describe, expect, it } from "vitest";
import {
  describeJsonArtifactRejection,
  filedReturnsJsonDocumentContract,
  validateArtifactBytes,
} from "../../src/connectors/gst/artifact-validation";
import { ARTIFACT_ACQUISITION_DIAGNOSTIC_SIGNALS } from "../../src/connectors/gst/filed-returns-acquisition-diagnostics";
import {
  PORTAL_BLOB_SHIM_SUPPRESSION_METHODS,
  RETURNS_DASHBOARD_ANCHOR_FAILURE_REASONS,
  isDurableFiledReturnsSignal,
} from "../../src/connectors/gst/filed-returns-durable-signals";

const encoder = new TextEncoder();

describe("validateArtifactBytes", () => {
  it("owns the canonical JSON envelope and return-period contract for every return type", () => {
    expect(filedReturnsJsonDocumentContract("GSTR-3B")).toEqual({
      envelopePath: ["data", "r3b"],
      requiredStatus: 1,
      returnPeriodKey: "ret_period",
    });
    expect(filedReturnsJsonDocumentContract("GSTR-1")).toEqual({
      envelopePath: ["data"],
      returnPeriodKey: "ret_period",
    });
    expect(filedReturnsJsonDocumentContract("GSTR-2B")).toEqual({
      envelopePath: ["data"],
      returnPeriodKey: "rtnprd",
    });
  });

  it("accepts a portal-shaped PDF", () => {
    const bytes = new Uint8Array(40 * 1024);
    bytes.set(encoder.encode("%PDF-1.7"));
    expect(validateArtifactBytes(bytes, "PDF", "042024")).toEqual({
      ok: true,
      mimeType: "application/pdf",
    });
  });

  it("rejects synthetic access-denied HTML as a PDF", () => {
    expect(
      validateArtifactBytes(encoder.encode("<html>access denied</html>"), "PDF", "042024"),
    ).toEqual({ ok: false, reason: "unexpected-content" });
  });

  it("rejects non-success JSON and a mismatched target period", () => {
    const failed = encoder.encode(
      JSON.stringify({
        status: 0,
        data: { r3b: { ret_period: "042024" } },
        padding: "x".repeat(100),
      }),
    );
    const mismatch = encoder.encode(
      JSON.stringify({
        status: 1,
        data: { r3b: { ret_period: "052024" } },
        padding: "x".repeat(100),
      }),
    );
    expect(validateArtifactBytes(failed, "JSON", "042024")).toEqual({
      ok: false,
      reason: "unexpected-content",
    });
    expect(validateArtifactBytes(mismatch, "JSON", "042024")).toEqual({
      ok: false,
      reason: "target-period-mismatch",
    });
  });

  it("rejects empty and oversized byte streams", () => {
    expect(validateArtifactBytes(new Uint8Array(), "PDF", "042024")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(validateArtifactBytes(new Uint8Array(40 * 1024 * 1024), "PDF", "042024")).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("validates GSTR-2B JSON at data.rtnprd and portal XLSX bytes", () => {
    const json = encoder.encode(
      JSON.stringify({ data: { rtnprd: "042024", padding: "x".repeat(100) }, chksum: "synthetic" }),
    );
    const workbook = new Uint8Array(1024);
    workbook.set([0x50, 0x4b]);
    expect(validateArtifactBytes(json, "JSON", "042024", "GSTR-2B")).toEqual({
      ok: true,
      mimeType: "application/json",
    });
    expect(validateArtifactBytes(workbook, "EXCEL", "042024", "GSTR-2B")).toEqual({
      ok: true,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(validateArtifactBytes(workbook, "PDF", "042024", "GSTR-2B")).toEqual({
      ok: false,
      reason: "unexpected-content",
    });
  });
});

describe("compact filed-return summary envelopes", () => {
  // Captured live on 2026-09-10: a filed GSTR-1 period with nothing in it answers the summary
  // preflight with a valid envelope well under 100 bytes. A size floor refused it before anything
  // read it, and the run blocked on a return that was filed and downloadable.
  const compactGstr1Envelope = encoder.encode(JSON.stringify({ data: { ret_period: "042025" } }));

  it("accepts a valid summary envelope that is smaller than a hundred bytes", () => {
    expect(compactGstr1Envelope.byteLength).toBeLessThan(100);
    expect(validateArtifactBytes(compactGstr1Envelope, "JSON", "042025", "GSTR-1")).toEqual({
      ok: true,
      mimeType: "application/json",
    });
  });

  // What the floor was standing in for, each caught by the contract instead and caught better.
  it("still refuses compact bodies the contract rejects", () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ["not JSON at all", encoder.encode("<html><body>error</body></html>"), "unexpected-content"],
      ["no envelope", encoder.encode(JSON.stringify({ status: 1 })), "unexpected-content"],
      [
        "no period field",
        encoder.encode(JSON.stringify({ data: { other: "x" } })),
        "unexpected-content",
      ],
      [
        "another period",
        encoder.encode(JSON.stringify({ data: { ret_period: "052025" } })),
        "target-period-mismatch",
      ],
    ];
    for (const [label, bytes, reason] of cases) {
      expect(bytes.byteLength, label).toBeLessThan(100);
      expect(validateArtifactBytes(bytes, "JSON", "042025", "GSTR-1"), label).toEqual({
        ok: false,
        reason,
      });
    }
  });

  it("still refuses an empty body", () => {
    expect(validateArtifactBytes(new Uint8Array(), "JSON", "042025", "GSTR-1")).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});

describe("acquisition diagnostics are persistable", () => {
  // The defect this pins: a diagnostic signal that is emitted but not registered rejects the
  // entire durable signal array, so the run halts on non-canonical recovery metadata instead of
  // recording the refusal the signal was there to explain. Emitting a new one without registering
  // it is worse than not emitting it at all.
  it("registers every acquisition diagnostic as a durable signal", () => {
    const unregistered = ARTIFACT_ACQUISITION_DIAGNOSTIC_SIGNALS.filter(
      (signal) => !isDurableFiledReturnsSignal(signal),
    );
    expect(unregistered).toEqual([]);
  });

  it("emits only registered signals when a compact body fails the contract", () => {
    const bodies = [
      encoder.encode("<html></html>"),
      encoder.encode(JSON.stringify({ status: 1 })),
      encoder.encode(JSON.stringify({ data: { other: "x" } })),
      encoder.encode(JSON.stringify({ data: { ret_period: "052025" } })),
      new Uint8Array(),
    ];
    for (const bytes of bodies) {
      for (const signal of describeJsonArtifactRejection(bytes, "042025", "GSTR-1")) {
        expect(isDurableFiledReturnsSignal(signal), signal).toBe(true);
      }
    }
  });
});

describe("template-built signals are persistable", () => {
  // These are assembled from a prefix and a variable, so a scan for signal string literals never
  // sees them. Three reached production unregistered, and each one rejected the entire durable
  // array it travelled in -- halting the run on non-canonical recovery metadata instead of on the
  // navigation problem the signal described.
  it("registers every returns-dashboard anchor failure and blob-shim suppression", () => {
    const built = [
      ...RETURNS_DASHBOARD_ANCHOR_FAILURE_REASONS.map(
        (reason) => `returns-dashboard-anchor-${reason}`,
      ),
      ...PORTAL_BLOB_SHIM_SUPPRESSION_METHODS.map(
        (method) => `portal-blob-shim-suppressed-via-${method}`,
      ),
    ];
    expect(built.filter((signal) => !isDurableFiledReturnsSignal(signal))).toEqual([]);
  });
});

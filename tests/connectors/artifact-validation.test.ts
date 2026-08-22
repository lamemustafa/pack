import { describe, expect, it } from "vitest";
import {
  filedReturnsJsonDocumentContract,
  validateArtifactBytes,
} from "../../src/connectors/gst/artifact-validation";

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

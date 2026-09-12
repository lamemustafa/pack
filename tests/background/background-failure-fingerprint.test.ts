import { describe, expect, it } from "vitest";
import { backgroundFailureFingerprint } from "../../src/background/background-failure-fingerprint";

// Frames as the service worker actually produces them: every line of a background stack points at
// a file served from the extension's own origin. A frame pointing anywhere else did not come from
// this bundle, and is the case the fingerprint must not repeat.
const BUNDLE = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/background.js";

describe("background failure fingerprint", () => {
  it("names the error class and the innermost symbol", () => {
    const error = new TypeError("boom");
    error.stack = `TypeError: boom\n    at parseDurableSummary (${BUNDLE}:1:1)\n    at next (${BUNDLE}:2:1)`;
    expect(backgroundFailureFingerprint(error)).toBe("TypeError at parseDurableSummary");
  });

  it("never repeats the error message", () => {
    const error = new Error("GSTIN 00AAAAA0000A1Z0 rejected at https://portal.example/x");
    error.stack = `${error.message}\n    at readLedger (${BUNDLE}:1:1)`;
    const fingerprint = backgroundFailureFingerprint(error);
    expect(fingerprint).toBe("Error at readLedger");
  });

  it("cannot be smuggled through by a thrown non-Error", () => {
    expect(backgroundFailureFingerprint("GSTIN 00AAAAA0000A1Z0")).toBe("NonError");
    expect(backgroundFailureFingerprint({ name: "x", stack: "at leak" })).toBe("NonError");
  });

  it("takes no symbol from a frame outside this bundle", () => {
    // The earlier filter deleted punctuation, so this frame came back as a plausible-looking
    // symbol -- laundered into safety by removing exactly the characters that exposed it. Origin
    // is what makes a symbol ours; a character class never could.
    const error = new Error("x");
    error.stack = `Error: x\n    at https://www.gst.gov.in/returns/auth/gstr1 (${BUNDLE}:1:1)`;
    const fingerprint = backgroundFailureFingerprint(error);
    expect(fingerprint).toBe("Error");
    expect(fingerprint).not.toContain("gst");
  });

  it("takes no symbol from an anonymous frame", () => {
    const error = new Error("x");
    error.stack = `Error: x\n    at ${BUNDLE}:1:1`;
    expect(backgroundFailureFingerprint(error)).toBe("Error");
  });

  it("refuses a name that is not shaped like an error class", () => {
    // Every error class in this bundle ends in `Error`, and so do the platform's. A name that does
    // not degrades to `Error` rather than being edited until it passes.
    const error = new Error("x");
    error.name = "GSTIN00AAAAA0000A1Z0";
    error.stack = `x\n    at readLedger (${BUNDLE}:1:1)`;
    const fingerprint = backgroundFailureFingerprint(error);
    expect(fingerprint).toBe("Error at readLedger");
    expect(fingerprint).not.toContain("AAAAA");
  });

  it("keeps the bundle's own error classes", () => {
    const error = new Error("x");
    error.name = "XlsxSizeLimitError";
    error.stack = `x\n    at writeWorkbook (${BUNDLE}:1:1)`;
    expect(backgroundFailureFingerprint(error)).toBe("XlsxSizeLimitError at writeWorkbook");
  });
});

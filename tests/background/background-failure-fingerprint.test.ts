import { describe, expect, it } from "vitest";
import { backgroundFailureFingerprint } from "../../src/background/background-failure-fingerprint";

describe("background failure fingerprint", () => {
  it("names the error class and the innermost symbol", () => {
    const error = new TypeError("boom");
    error.stack = "TypeError: boom\n    at parseDurableSummary (file.js:1:1)\n    at next (f.js:2)";
    expect(backgroundFailureFingerprint(error)).toBe("TypeError at parseDurableSummary");
  });

  it("never repeats the error message", () => {
    const error = new Error("GSTIN 00AAAAA0000A1Z0 rejected at https://portal.example/x");
    error.stack = `${error.message}\n    at readLedger (file.js:1:1)`;
    const fingerprint = backgroundFailureFingerprint(error);
    expect(fingerprint).not.toContain("GSTIN");
    expect(fingerprint).not.toContain("0AAAAA0000A1Z0");
    expect(fingerprint).not.toContain("https");
  });

  it("cannot be smuggled through by a thrown non-Error", () => {
    expect(backgroundFailureFingerprint("GSTIN 00AAAAA0000A1Z0")).toBe("NonError");
    expect(backgroundFailureFingerprint({ name: "x", stack: "at leak" })).toBe("NonError");
  });

  it("strips anything outside the symbol charset", () => {
    const error = new Error("x");
    error.name = "Bad Name/With Spaces";
    error.stack = "e\n    at some symbol with spaces (f.js:1)";
    // Only the literal " at " separator may contain spaces; both symbols are charset-filtered.
    expect(backgroundFailureFingerprint(error)).toBe("BadNameWithSpaces at some");
  });
});

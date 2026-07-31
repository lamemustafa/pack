import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFiledReturnsLedgerId,
  isCanonicalFiledReturnsLedgerId,
  isCanonicalFullFiscalYearLedgerId,
  isCanonicalSinglePeriodLedgerId,
} from "../../src/connectors/gst/filed-returns-ledger-id";

describe("filed-return ledger IDs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates opaque full-year and single-period IDs", () => {
    const fullFiscalYear = createFiledReturnsLedgerId("full-fiscal-year");
    const singlePeriod = createFiledReturnsLedgerId("single-period");

    expect(isCanonicalFullFiscalYearLedgerId(fullFiscalYear)).toBe(true);
    expect(isCanonicalSinglePeriodLedgerId(singlePeriod)).toBe(true);
    expect(isCanonicalFiledReturnsLedgerId(fullFiscalYear)).toBe(true);
    expect(isCanonicalFiledReturnsLedgerId(singlePeriod)).toBe(true);
  });

  it("uses a fixed-width hexadecimal fallback and rejects name-like IDs", () => {
    vi.stubGlobal("crypto", {});
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(createFiledReturnsLedgerId("full-fiscal-year", new Date(0))).toBe(
      "00000000000080000000",
    );
    expect(createFiledReturnsLedgerId("single-period", new Date(0))).toBe(
      "single-period:00000000000080000000",
    );
    expect(isCanonicalFullFiscalYearLedgerId("full-fiscal-year-synthetic-taxpayer-name")).toBe(
      false,
    );
    expect(isCanonicalSinglePeriodLedgerId("single-period:synthetic-taxpayer-name")).toBe(false);
  });

  it("retains only exact historical fallback shapes for cleanup", () => {
    expect(isCanonicalFullFiscalYearLedgerId("full-fiscal-year-m0abc123")).toBe(true);
    expect(isCanonicalSinglePeriodLedgerId("single-period:m0abc123-abc123def0")).toBe(true);
    expect(isCanonicalFullFiscalYearLedgerId("full-fiscal-year-legacy-cleanup")).toBe(false);
    expect(isCanonicalSinglePeriodLedgerId("single-period:legacy-cleanup")).toBe(false);
  });
});

import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  FINANCIAL_YEAR_LABEL,
  RETURN_TYPE_LABEL,
  acceptedReturnTypeOptions,
  selectFieldOption,
  waitForFieldSelection,
} from "../../src/connectors/gst/filed-returns-filter-selection";

describe("filed-return filter selection", () => {
  it("allows GST dependent controls to settle after a selected financial year", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = new JSDOM(`
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select id="finYr"><option selected>2026-27</option></select>
        </form>
      `).window.document;
      let settled = false;
      const selection = waitForFieldSelection(documentRef, FINANCIAL_YEAR_LABEL, ["2026-27"]).then(
        () => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(499);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await selection;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not select GSTR-10 for a requested GSTR-1 return", async () => {
    const documentRef = new JSDOM(`
      <form name="efiledReturns">
        <label>Return Type</label>
        <select id="retTyp">
          <option>Select</option>
          <option>GSTR-10</option>
          <option>GSTR-1A</option>
          <option>GSTR-1/IFF/GSTR-1A</option>
        </select>
      </form>
    `).window.document;

    await expect(
      selectFieldOption(
        documentRef,
        RETURN_TYPE_LABEL,
        acceptedReturnTypeOptions({
          financialYear: "2025-26",
          period: "April",
          returnType: "GSTR-1",
        }),
      ),
    ).resolves.toBe(true);
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe(
      "GSTR-1/IFF/GSTR-1A",
    );
  });
});

import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  FINANCIAL_YEAR_LABEL,
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
});

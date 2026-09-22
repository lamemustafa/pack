import { describe, expect, it } from "vitest";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";

// Nobody files an auto-drafted GSTR-2B statement; the saved run details must not say one was not
// filed. Live 2026-09-22 for 2B periods the Returns Dashboard did not offer.
describe("durable not-filed message", () => {
  const scope = (returnType: "GSTR-1" | "GSTR-2B") =>
    ({ artifactType: "PDF", financialYear: "2025-26", period: "April", returnType }) as const;

  it("names the missing GSTR-2B statement instead of an unfiled return", () => {
    const { safeMessage } = canonicalDurableTargetStatus(scope("GSTR-2B"), "not-filed", [
      "filed-return-positively-not-filed",
    ]);

    expect(safeMessage).toContain("GSTR-2B statement");
    expect(safeMessage).not.toMatch(/not filed|no filed/i);
  });

  it("keeps the not-filed message for a filed return", () => {
    const { safeMessage } = canonicalDurableTargetStatus(scope("GSTR-1"), "not-filed", [
      "filed-return-positively-not-filed",
    ]);

    expect(safeMessage).toBe("The GST Portal reported no filed return for the selected period.");
  });
});

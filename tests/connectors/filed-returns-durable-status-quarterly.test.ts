import { describe, expect, it } from "vitest";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";

// Live 2026-09-22: a quarterly (QRMP) taxpayer. The stop must survive the durable boundary with its
// own reason, not as a rejected signal set or the generic "resolve the GST Portal page" message.
describe("durable quarterly-filer stop", () => {
  const scope = {
    artifactType: "PDF",
    financialYear: "2025-26",
    period: "April",
    returnType: "GSTR-3B",
  } as const;
  const signals = ["filed-return-api-searched", "filed-gstr3b-quarterly-filer-unsupported"];

  it("keeps its signal and names the quarterly filer", () => {
    const durable = canonicalDurableTargetStatus(scope, "blocked", signals);

    expect(durable.safeSignals).toEqual(signals);
    expect(durable.safeMessage).toMatch(/quarterly/i);
    expect(durable.safeMessage).toMatch(/monthly filers only/i);
    expect(durable.safeMessage).not.toMatch(/retry|resolve the GST Portal page/i);
  });
});

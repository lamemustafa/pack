import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  FiledReturnsFlowSummary,
  FiledReturnsTargetEvidence,
} from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { TargetEvidence } from "../../src/entrypoints/popup/target-evidence";

describe("per-target evidence", () => {
  const summaryWith = (targetEvidence: FiledReturnsTargetEvidence[]): FiledReturnsFlowSummary => ({
    scope: {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    status: "partial",
    completedPeriods: targetEvidence
      .filter((entry) => entry.outcome === "saved" || entry.outcome === "not-filed")
      .map((entry) => entry.period),
    targetEvidence,
    totalPeriods: targetEvidence.length,
    updatedAt: "2026-08-23T12:00:00.000Z",
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeMessage: "",
      safeSignals: [],
    },
  });

  // The count behind "12 periods saved as one ZIP" groups `downloaded` with
  // `not-filed`, so a year where the taxpayer filed nothing read as twelve saved
  // files. The status line here counts saved files only.
  it("counts saved files rather than finished periods", () => {
    const markup = renderToStaticMarkup(
      <TargetEvidence
        summary={summaryWith([
          { period: "April", outcome: "saved" },
          { period: "May", outcome: "not-filed" },
          { period: "June", outcome: "not-filed" },
        ])}
      />,
    );

    expect(markup).toContain("1 of 3 saved");
    expect(markup).not.toContain("3 of 3");
  });

  // An aggregate cannot express a partially-settled run. This is the case #190
  // was filed from: something finished, something did not, and one number
  // cannot say both.
  it("names the period that needs review beside the ones that did not", () => {
    const markup = renderToStaticMarkup(
      <TargetEvidence
        summary={summaryWith([
          { period: "April", outcome: "saved" },
          { period: "May", outcome: "needs-review" },
        ])}
      />,
    );

    expect(markup).toContain("1 needs review");
    expect(markup).toContain("May");
    expect(markup).toContain("Needs review");
  });

  // Only `saved` asserts correlated download evidence. A manual observation is
  // a person's report, and the runtime already refuses to complete a target on
  // one -- this is that refusal made visible rather than a second opinion.
  it("does not present a manual observation as a saved file", () => {
    const markup = renderToStaticMarkup(
      <TargetEvidence summary={summaryWith([{ period: "April", outcome: "needs-review" }])} />,
    );

    expect(markup).toContain("0 of 1 saved");
    expect(markup).not.toContain("Saved");
  });

  it("renders nothing when the run carries no per-target evidence", () => {
    const summary = summaryWith([{ period: "April", outcome: "saved" }]);
    delete summary.targetEvidence;

    expect(renderToStaticMarkup(<TargetEvidence summary={summary} />)).toBe("");
    expect(renderToStaticMarkup(<TargetEvidence summary={null} />)).toBe("");
  });

  it("collapses uniform evidence behind the file-count status", () => {
    const markup = renderToStaticMarkup(
      <TargetEvidence
        summary={summaryWith(
          Array.from({ length: 12 }, (_, index) => ({
            period: `Period ${index + 1}`,
            outcome: "saved" as const,
          })),
        )}
      />,
    );

    expect(markup).toContain("12 of 12 saved");
    expect(markup).toContain("<details");
    expect(markup).toContain("Show per-period results");
  });

  it("keeps mixed-run exceptions visible while collapsing the repeated outcome", () => {
    const markup = renderToStaticMarkup(
      <TargetEvidence
        summary={summaryWith([
          ...Array.from({ length: 10 }, (_, index) => ({
            period: `Saved ${index + 1}`,
            outcome: "saved" as const,
          })),
          { period: "May", outcome: "needs-review" },
          { period: "June", outcome: "needs-review" },
        ])}
      />,
    );
    const visibleMarkup = markup.split("<details")[0] ?? "";

    expect(visibleMarkup).toContain("May");
    expect(visibleMarkup).toContain("June");
    expect(visibleMarkup).toContain("Needs review");
    expect(visibleMarkup).not.toContain("Saved 1");
  });
  // A partly saved period is in none of the other three counts, so without its
  // own clause the header would say "1 of 2 saved" and leave the second period
  // unaccounted for anywhere on the line.
  it("accounts for a partly saved period in the status line", () => {
    const markup = renderToStaticMarkup(
      <TargetEvidence
        summary={summaryWith([
          { period: "April", outcome: "saved" },
          { period: "May", outcome: "partly-saved" },
        ])}
      />,
    );

    expect(markup).toContain("1 of 2 saved");
    expect(markup).toContain("1 partly saved");
  });

  // The word carries the meaning, not the hue: the row reads the same to someone
  // who cannot separate the colours.
  it("names the partly saved outcome in the row", () => {
    const markup = renderToStaticMarkup(
      <TargetEvidence summary={summaryWith([{ period: "April", outcome: "partly-saved" }])} />,
    );

    expect(markup).toContain("Partly saved");
    expect(markup).toContain("evidence-partly-saved");
  });
});

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

  it("names a not-generated statement without counting it as a saved file", () => {
    const summary = summaryWith([{ period: "April", outcome: "not-generated" }]);
    summary.scope = { ...summary.scope, artifactType: "EXCEL", returnType: "GSTR-2B" };

    const markup = renderToStaticMarkup(<TargetEvidence summary={summary} />);

    expect(markup).toContain("April");
    expect(markup).toContain("Not generated");
    expect(markup).toContain("0 of 1 saved");
    expect(markup).not.toContain("Saved");
    expect(markup).not.toContain("Needs review");
  });

  it("renders nothing when the run carries no per-target evidence", () => {
    const summary = summaryWith([{ period: "April", outcome: "saved" }]);
    delete summary.targetEvidence;

    expect(renderToStaticMarkup(<TargetEvidence summary={summary} />)).toBe("");
    expect(renderToStaticMarkup(<TargetEvidence summary={null} />)).toBe("");
  });
  // Every artifact missing from a `partly-saved` period is one the portal itself said does not
  // exist (a GSTR-1 period without e-invoice details has no Excel). "Partly saved" read as a
  // failure to a reader (2026-09-17), so the period counts as saved and the line says why some
  // formats are absent, instead of sending the reader looking for a missing file.
  it("counts a period with everything the portal offered as saved, and says why formats are missing", () => {
    const markup = renderToStaticMarkup(
      <TargetEvidence
        summary={summaryWith([
          { period: "April", outcome: "saved" },
          { period: "May", outcome: "partly-saved" },
        ])}
      />,
    );

    expect(markup).toContain("2 of 2 saved");
    expect(markup).toContain("1 without a format the portal does not have");
    expect(markup).not.toMatch(/partly saved/i);
  });

  // The word carries the meaning, not the hue: the row reads the same to someone
  // who cannot separate the colours.
  it("names the period saved in the row, with the reason formats are missing", () => {
    const markup = renderToStaticMarkup(
      <TargetEvidence summary={summaryWith([{ period: "April", outcome: "partly-saved" }])} />,
    );

    expect(markup).toContain(">Saved · some formats not on portal<");
    expect(markup).not.toMatch(/partly saved/i);
    expect(markup).toContain("evidence-partly-saved");
  });
});

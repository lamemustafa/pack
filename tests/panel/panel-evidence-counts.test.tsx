import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsFlowSummary,
  FiledReturnsTargetEvidence,
} from "../../src/connectors/gst/filed-returns-contracts";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));

import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { completedPanelSummary, panelController } from "./panel-controller.test-helpers";

function summaryWith(
  targetEvidence: FiledReturnsTargetEvidence[] | undefined,
  status: FiledReturnsFlowSummary["status"] = "blocked",
): FiledReturnsFlowSummary {
  return completedPanelSummary({
    status,
    currentPeriod: "April",
    completedPeriods: (targetEvidence ?? [])
      .filter(({ outcome }) => outcome === "saved" || outcome === "not-filed")
      .map(({ period }) => period),
    ...(targetEvidence ? { targetEvidence } : {}),
    totalPeriods: targetEvidence?.length ?? 12,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: status === "running" ? "clicked" : "blocked",
      safeSignals: [],
      safeMessage: "Synthetic run requires an explicit check before continuing.",
    },
  });
}

function renderSummary(summary: FiledReturnsFlowSummary) {
  return renderToStaticMarkup(
    <PanelSurface
      pack={panelController({
        scope: summary.scope,
        scopedFlowSummary: summary,
      })}
    />,
  );
}

function reviewCounts(markup: string) {
  return markup.match(/\b\d+ needs review/g) ?? [];
}

describe("panel evidence count ownership", () => {
  it("shows one review count and eleven waiting periods, not twelve reviews", () => {
    const summary = summaryWith(
      FILED_RETURNS_MONTHS.map((period, index) => ({
        period,
        outcome: index === 0 ? "needs-review" : "pending",
      })),
    );
    const markup = renderSummary(summary);

    expect(reviewCounts(markup)).toEqual(["1 needs review"]);
    expect(markup.match(/>Waiting</g)).toHaveLength(11);
    expect(markup).toContain("0 of 12 saved");
    expect(markup).toContain("April needs a quick check");
    expect(markup).toContain(summary.flowStep.safeMessage);
    expect(markup).not.toMatch(/\b\d+ ready\b/);
  });

  it("keeps every explicit outcome distinct without a second ready/review aggregate", () => {
    const summary = summaryWith([
      { period: "April", outcome: "saved" },
      { period: "May", outcome: "not-filed" },
      { period: "June", outcome: "partly-saved" },
      { period: "July", outcome: "captured" },
      { period: "August", outcome: "needs-review" },
      { period: "September", outcome: "running" },
      { period: "October", outcome: "pending" },
    ]);
    summary.currentPeriod = "August";
    const markup = renderSummary(summary);

    expect(reviewCounts(markup)).toEqual(["1 needs review"]);
    expect(markup).toContain("1 of 7 saved");
    expect(markup).toContain("1 partly saved");
    expect(markup).toContain("1 captured, ZIP not confirmed");
    for (const label of ["Not filed", "In progress", "Waiting", "Needs review"]) {
      expect(markup).toContain(`>${label}<`);
    }
    expect(markup).not.toMatch(/\b\d+ ready\b/);
  });

  it.each(["running", "cancelled"] as const)(
    "does not label untouched periods as needing review in a %s run",
    (status) => {
      const summary = summaryWith(
        FILED_RETURNS_MONTHS.map((period) => ({ period, outcome: "pending" })),
        status,
      );
      const markup = renderSummary(summary);

      expect(reviewCounts(markup)).toEqual([]);
      expect(markup.match(/>Waiting</g)).toHaveLength(12);
      expect(markup).toContain(
        status === "running" ? "Packing your files" : "Ready for a new download",
      );
      expect(markup).not.toMatch(/\b\d+ ready\b/);
    },
  );

  describe.each(["omitted", "empty"] as const)("%s target evidence", (evidenceState) => {
    it.each(["blocked", "partial", "running"] as const)(
      "does not invent numeric outcomes for a %s summary",
      (status) => {
        const summary = summaryWith(evidenceState === "empty" ? [] : undefined, status);
        summary.totalPeriods = 12;
        const markup = renderSummary(summary);

        expect(reviewCounts(markup)).toEqual([]);
        expect(markup).not.toContain("Per-period result");
        expect(markup).not.toMatch(/\b\d+ ready\b/);
        expect(markup).toContain(
          status === "running" ? "Filed-returns run in progress" : "browser download not confirmed",
        );
        expect(markup).not.toContain("saved by your browser");
        if (status !== "running") expect(markup).toContain(summary.flowStep.safeMessage);
      },
    );
  });

  it.each(["delivered", "not-filed"] as const)(
    "keeps a completed %s run free of invented review counts",
    (kind) => {
      const summary = summaryWith(
        [{ period: "April", outcome: kind === "delivered" ? "saved" : "not-filed" }],
        "complete",
      );
      summary.flowStep.safeSignals = [
        "full-fiscal-year-complete",
        kind === "delivered"
          ? "full-fiscal-year-zip-downloaded"
          : "full-fiscal-year-no-zip-artifacts",
      ];
      const markup = renderSummary(summary);

      expect(reviewCounts(markup)).toEqual([]);
      expect(markup).not.toMatch(/\b\d+ ready\b/);
      expect(markup).toContain(
        kind === "delivered"
          ? "One ZIP · saved by your browser"
          : "No ZIP created · no eligible files",
      );
      expect(markup).toContain(kind === "delivered" ? "1 of 1 saved" : "0 of 1 saved");
      if (kind === "not-filed") expect(markup).not.toContain("saved by your browser");
    },
  );

  it.each([true, false])(
    "retains single-period cleanup warning and local retry with target evidence=%s",
    (withEvidence) => {
      const base = summaryWith(
        withEvidence ? [{ period: "April", outcome: "needs-review" }] : undefined,
      );
      const summary: FiledReturnsFlowSummary = {
        ...base,
        scope: {
          ...base.scope,
          period: "April",
          returnType: "GSTR-2B",
          artifactType: "PDF_AND_EXCEL",
        },
        totalPeriods: 1,
        flowStep: {
          ...base.flowStep,
          scopeId: "gst-gstr2b-private-v0",
          state: "download-unconfirmed",
          safeSignals: [
            "single-period-zip-downloaded",
            "browser-download-id:42",
            "browser-download-completed",
            "browser-download-non-empty",
            "single-period-opfs-clear-failed",
            "filed-returns-target-review-required",
            "filed-returns-target-local-cleanup-required",
          ],
          safeMessage: "Pack confirmed the selected ZIP download; temporary staging remains.",
        },
      };
      const markup = renderToStaticMarkup(
        <PanelSurface
          pack={panelController({
            context: null,
            scope: summary.scope,
            scopedFlowSummary: summary,
            recoverySummary: summary,
            lastRunSummary: summary,
          })}
        />,
      );

      expect(reviewCounts(markup)).toEqual(withEvidence ? ["1 needs review"] : []);
      expect(markup).toContain("All formats");
      expect(markup).toContain("Saved by your browser");
      expect(markup).toContain("April needs review");
      expect(markup).toContain(
        "Retry the local cleanup; Pack will not click the GST Portal again.",
      );
      expect(markup).toMatch(/<button[^>]*>Retry local cleanup<\/button>/);
      expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>Retry local cleanup<\/button>/);
      expect(markup).not.toMatch(/\b\d+ ready\b/);
    },
  );

  it("keeps recovery evidence under its saved scope after the selected scope changes", () => {
    const summary = summaryWith([
      { period: "April", outcome: "needs-review" },
      { period: "May", outcome: "pending" },
    ]);
    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={panelController({
          scope: { ...summary.scope, period: "June" },
          scopedFlowSummary: null,
          recoverySummary: summary,
          lastRunSummary: summary,
        })}
      />,
    );

    expect(reviewCounts(markup)).toEqual(["1 needs review"]);
    expect(markup).toContain("June period");
    expect(markup).toContain("April needs a quick check");
    expect(markup).toContain("0 of 2 saved");
    expect(markup).toContain(">Waiting<");
    expect(markup).not.toMatch(/\b\d+ ready\b/);
  });
});

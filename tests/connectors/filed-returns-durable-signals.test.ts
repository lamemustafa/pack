import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { detectFiledReturnDetailPage } from "../../src/connectors/gst/filed-returns-detail-page-guard";
import { scoreFiledReturnDownloadCandidate } from "../../src/connectors/gst/filed-returns-download-candidates";
import {
  isDurableFiledReturnsSignal,
  parseDurableFiledReturnsSignals,
} from "../../src/connectors/gst/filed-returns-durable-signals";
import { scoreFiledReturnsSummaryModalDismissalCandidate } from "../../src/connectors/gst/filed-returns-navigation-candidates";
import {
  GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES,
  Gstr2bArtifactDispatchFailureReason,
} from "../../src/background/filed-returns-download-trigger";

describe("filed-return durable signal contract", () => {
  it("retains the filename-free ZIP override marker", () => {
    expect(isDurableFiledReturnsSignal("zip-download-filename-overridden")).toBe(true);
    expect(parseDurableFiledReturnsSignals(["zip-download-filename-overridden"])).toEqual([
      "zip-download-filename-overridden",
    ]);
  });

  it("accepts the bounded signals emitted by detail, download, and summary-dialog classifiers", () => {
    const emittedSignals = new Set<string>();

    collect(
      emittedSignals,
      detectFiledReturnDetailPage(
        detailDocument(
          `
            <h1>GSTR-3B - Monthly Return</h1>
            <p>Status - Filed</p>
            <button>DOWNLOAD FILED GSTR-3B</button>
            <p>No files available for download</p>
          `,
          "https://return.gst.gov.in/returns/auth/gstr3b",
        ),
        "GSTR-3B",
        "PDF",
      ).safeSignals,
    );
    collect(
      emittedSignals,
      detectFiledReturnDetailPage(
        detailDocument(
          `
            <h1>GSTR-1</h1>
            <p>Status - Filed</p>
            <button>DOWNLOAD FILED GSTR-1</button>
            <button>DOWNLOAD DETAILS E-INVOICES EXCEL</button>
            <button>DOWNLOAD PDF</button>
          `,
          "https://return.gst.gov.in/returns/auth/gstr1",
        ),
        "GSTR-1",
        "EXCEL",
      ).safeSignals,
    );
    collect(
      emittedSignals,
      detectFiledReturnDetailPage(
        detailDocument(
          `
            <h1>GSTR-2B</h1>
            <p>Status Filed</p>
            <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
            <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
          `,
          "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
        ),
        "GSTR-2B",
        "EXCEL",
      ).safeSignals,
    );

    const scoredCandidates = [
      scoreFiledReturnDownloadCandidate(
        { text: "DOWNLOAD FILED GSTR-3B SYSTEM GENERATED SAVE" },
        "GSTR-3B",
      ),
      scoreFiledReturnDownloadCandidate({ text: "DOWNLOAD FILED GSTR-1 PDF SAVE EXCEL" }, "GSTR-1"),
      scoreFiledReturnDownloadCandidate({ text: "DOWNLOAD PDF" }, "GSTR-1"),
      scoreFiledReturnDownloadCandidate(
        { text: "DOWNLOAD DETAILS E-INVOICES EXCEL PDF SAVE" },
        "GSTR-1",
        "EXCEL",
      ),
      scoreFiledReturnDownloadCandidate(
        { text: "DOWNLOAD GSTR-2B SUMMARY PDF SAVE EXCEL" },
        "GSTR-2B",
      ),
      scoreFiledReturnDownloadCandidate(
        { text: "DOWNLOAD GSTR-2B DETAILS E-INVOICES EXCEL PDF SAVE" },
        "GSTR-2B",
        "EXCEL",
      ),
      scoreFiledReturnDownloadCandidate({ text: "GSTR-1" }, "GSTR-1"),
    ];
    for (const scoredCandidate of scoredCandidates) {
      collect(emittedSignals, scoredCandidate.safeSignals);
    }

    collect(
      emittedSignals,
      scoreFiledReturnsSummaryModalDismissalCandidate({
        ariaLabel: "Close",
        className: "close",
        text: "",
      }).safeSignals,
    );
    collect(
      emittedSignals,
      scoreFiledReturnsSummaryModalDismissalCandidate({ text: "x" }).safeSignals,
    );
    collect(
      emittedSignals,
      scoreFiledReturnsSummaryModalDismissalCandidate({ text: "Download" }).safeSignals,
    );

    const signals = [...emittedSignals];
    expect(signals.length).toBeGreaterThan(20);
    expect(signals.filter((signal) => !isDurableFiledReturnsSignal(signal))).toEqual([]);
    const representativeRuntimeVector = signals.slice(0, 32);
    expect(parseDurableFiledReturnsSignals(representativeRuntimeVector)).toEqual(
      representativeRuntimeVector,
    );
  });

  it("continues to reject unknown, interpolated, duplicate, and over-cap signal vectors", () => {
    for (const suffix of [
      "capture-control-artifact-mismatch",
      "capture-target-binding-invalid",
      "capture-target-evidence-conflict",
    ]) {
      expect(isDurableFiledReturnsSignal(`filed-gstr3b-${suffix}`)).toBe(true);
    }
    expect(isDurableFiledReturnsSignal("gstr3b-detail-route:private-value")).toBe(false);
    expect(isDurableFiledReturnsSignal("text-download-filed-gstr9")).toBe(false);
    expect(parseDurableFiledReturnsSignals(["status-filed", "status-filed"])).toBeNull();
    expect(
      parseDurableFiledReturnsSignals(
        Array.from({ length: 33 }, (_, index) => `browser-download-id:${index + 1}`),
      ),
    ).toBeNull();
  });

  it("accepts bounded GSTR-1 dashboard recovery signals without persisting selected values", () => {
    const signals = [
      "gstr1-filed-returns-route-mismatched",
      "return-dashboard-initial-scan",
      "return-dashboard-after-services-menu",
      "return-dashboard-after-returns-menu",
      "no-return-dashboard-candidate",
      "gstr1-return-dashboard-route",
      "gstr1-dashboard-root-found",
      "gstr1-dashboard-year-select-found",
      "gstr1-dashboard-quarter-select-found",
      "gstr1-dashboard-period-select-found",
      "gstr1-dashboard-search-found",
      "gstr1-return-dashboard-filters-selected",
      "gstr1-return-dashboard-search-results-pending",
      "gstr1-dashboard-view-clicked",
    ];

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);
    expect(isDurableFiledReturnsSignal("gstr1-dashboard-selected-period:april")).toBe(false);
    expect(isDurableFiledReturnsSignal("gstr1-dashboard-selected-year:2026-27")).toBe(false);
  });

  it("accepts every GSTR-2B acquisition terminal reason for durable summaries", () => {
    const reasons = Object.values(Gstr2bArtifactDispatchFailureReason);

    expect(parseDurableFiledReturnsSignals(reasons)).toEqual(reasons);
    for (const reason of reasons) {
      expect(GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES[reason].trim()).not.toBe("");
    }
  });

  it("accepts only the fixed categorical capture-context diagnostics", () => {
    const diagnosticSuffixes = [
      "xhr-selection-closed-with-context",
      "xhr-selection-closed-without-context",
      "xhr-page-callback-bound-readystatechange",
      "xhr-page-callback-bound-load",
      "xhr-page-callback-bound-loadend",
      "unbound-create-object-url-no-open-selection",
      "unbound-create-object-url-selection-open-no-context",
      "unbound-create-object-url-selection-open-invalid-context",
      "unbound-create-object-url-selection-open-valid-inactive-context",
    ];
    const signals = diagnosticSuffixes.map((suffix) => `filed-gstr3b-${suffix}`);

    expect(parseDurableFiledReturnsSignals(signals)).toEqual(signals);

    for (const signal of [
      `${signals[0]}:1`,
      `${signals[2]}:event=loadend`,
      `${signals[6]}:private-value`,
      `${signals[8]}-extra`,
      `filed-gstr9-${diagnosticSuffixes[0]}`,
    ]) {
      expect(isDurableFiledReturnsSignal(signal)).toBe(false);
      expect(parseDurableFiledReturnsSignals([signals[0], signal])).toBeNull();
    }
  });
});

function collect(target: Set<string>, signals: readonly string[]): void {
  for (const signal of signals) target.add(signal);
}

function detailDocument(body: string, url: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
    url,
  }).window.document;
}

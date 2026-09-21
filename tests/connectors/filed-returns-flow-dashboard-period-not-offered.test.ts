import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetStatusFromFlowStep } from "../../src/background/filed-returns-full-fiscal-year-summary";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import { createGstDocument, makeLayoutVisible } from "./filed-returns-flow.test-helpers";

// Captured live 2026-09-21 from a taxpayer whose returns start in July 2025: for 2025-26 the
// Returns Dashboard offered Quarters 2-4 and no Quarter 1, with Quarter 4 and March selected.
function dashboard(options: { year: string; quarters: string[]; months: string[] }): Document {
  const select = (id: string, values: string[]) =>
    `<select id="${id}">${values
      .map(
        (value, index) =>
          `<option${index === values.length - 1 ? " selected" : ""}>${value}</option>`,
      )
      .join("")}</select>`;
  const documentRef = createGstDocument(
    `
      <main>
        <form name="dashboard">
          <label for="fy">Financial Year</label>
          <select id="fy"><option>2026-27</option><option ${options.year === "2025-26" ? "selected" : ""}>2025-26</option></select>
          <label for="quarter">Quarter</label>
          ${select("quarter", options.quarters)}
          <label for="period">Period</label>
          ${select("period", options.months)}
          <button type="button" data-search>SEARCH</button>
        </form>
      </main>
    `,
    "https://return.gst.gov.in/returns/auth/dashboard",
  );
  makeLayoutVisible(documentRef);
  return documentRef;
}

const LIVE_QUARTERS = ["Quarter 2 (Jul - Sep)", "Quarter 3 (Oct - Dec)", "Quarter 4 (Jan - Mar)"];
const LIVE_MONTHS = ["January", "February", "March"];

function scope(returnType: FiledReturnsDownloadScope["returnType"], period: string) {
  return { artifactType: "PDF", financialYear: "2025-26", period, returnType } as const;
}

function countSearches(documentRef: Document): () => number {
  let clicks = 0;
  documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
    clicks += 1;
  });
  return () => clicks;
}

// Two looks count only when the second comes 2-12 s after the first: sooner could both land inside
// one list rebuild, later could join evidence from an earlier, unrelated attempt.
let now = 1_000_000;
function wait(ms: number) {
  now += ms;
}
function step(documentRef: Document, target: FiledReturnsDownloadScope, afterMs = 2_500) {
  wait(afterMs);
  return runFiledReturnsDownloadStep(documentRef, target);
}

describe("filed returns flow — a period the Returns Dashboard does not offer", () => {
  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["GSTR-1", "GSTR-2B"] as const)(
    "records %s April as not filed when the loaded quarter list has no Quarter 1, after two looks",
    async (returnType) => {
      const documentRef = dashboard({
        year: "2025-26",
        quarters: LIVE_QUARTERS,
        months: LIVE_MONTHS,
      });
      const searches = countSearches(documentRef);
      const target = scope(returnType, "April");

      const first = await step(documentRef, target);
      const second = await step(documentRef, target);

      expect(first.state).toBe("clicked");
      expect(first.safeSignals).not.toContain("filed-return-positively-not-filed");
      expect(second.state).toBe("candidate-not-found");
      expect(second.safeSignals).toContain("filed-return-positively-not-filed");
      expect(second.safeMessage).toContain("does not offer April 2025-26");
      expect(searches()).toBe(0);

      // The answer must survive the durable boundary as not-filed, not as a rejected signal set.
      expect(targetStatusFromFlowStep(second, returnType)).toBe("not-filed");
      const durable = canonicalDurableTargetStatus(target, "not-filed", second.safeSignals);
      expect(durable.safeSignals).not.toContain("filed-return-durable-status-rejected");
    },
  );

  it("records a month missing from its own quarter's loaded month list as not filed", async () => {
    const documentRef = dashboard({
      year: "2025-26",
      quarters: ["Quarter 1 (Apr - Jun)", "Quarter 2 (Jul - Sep)"],
      months: ["August", "September"],
    });
    const target = scope("GSTR-1", "July");

    await step(documentRef, target);
    const second = await step(documentRef, target);

    expect(second.state).toBe("candidate-not-found");
    expect(second.safeSignals).toContain("filed-return-positively-not-filed");
  });

  it("never reads a month list left over from another quarter as an answer", async () => {
    const documentRef = dashboard({
      year: "2025-26",
      quarters: ["Quarter 4 (Jan - Mar)", "Quarter 1 (Apr - Jun)"],
      months: LIVE_MONTHS,
    });
    const target = scope("GSTR-1", "April");

    const results = [];
    for (let look = 0; look < 3; look += 1) {
      results.push(await step(documentRef, target));
    }

    for (const result of results) {
      expect(result.state).not.toBe("candidate-not-found");
      expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
    }
  });

  it("never reads a quarter list that has not loaded yet as an answer", async () => {
    const documentRef = dashboard({ year: "2025-26", quarters: ["Select"], months: ["Select"] });
    const target = scope("GSTR-1", "April");

    await step(documentRef, target);
    const second = await step(documentRef, target);

    expect(second.state).not.toBe("candidate-not-found");
    expect(second.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not count a second look that comes too soon, then counts one inside the window", async () => {
    const documentRef = dashboard({
      year: "2025-26",
      quarters: LIVE_QUARTERS,
      months: LIVE_MONTHS,
    });
    const target = scope("GSTR-1", "April");

    await step(documentRef, target);
    const tooSoon = await step(documentRef, target, 500);
    const inWindow = await step(documentRef, target, 2_000);

    expect(tooSoon.state).not.toBe("candidate-not-found");
    expect(tooSoon.safeSignals).toContain("gstr1-return-dashboard-period-not-offered-pending");
    expect(inWindow.state).toBe("candidate-not-found");
  });

  it("never joins a first look from an earlier attempt to a much later one", async () => {
    const documentRef = dashboard({
      year: "2025-26",
      quarters: LIVE_QUARTERS,
      months: LIVE_MONTHS,
    });
    const target = scope("GSTR-1", "April");

    await step(documentRef, target);
    const hoursLater = await step(documentRef, target, 6 * 60 * 60 * 1_000);
    const next = await step(documentRef, target);

    expect(hoursLater.state).not.toBe("candidate-not-found");
    expect(hoursLater.safeSignals).toContain("gstr1-return-dashboard-period-not-offered-pending");
    expect(next.state).toBe("candidate-not-found");
  });

  it("does not read a quarter list rebuilt quickly after a year change as an answer", async () => {
    const documentRef = dashboard({
      year: "2026-27",
      quarters: LIVE_QUARTERS,
      months: LIVE_MONTHS,
    });
    const target = scope("GSTR-1", "April");

    const yearStep = await step(documentRef, target);
    const firstLook = await step(documentRef, target, 200);
    const tooSoon = await step(documentRef, target, 300);
    const quarter = documentRef.querySelector<HTMLSelectElement>("#quarter")!;
    const option = documentRef.createElement("option");
    option.textContent = "Quarter 1 (Apr - Jun)";
    quarter.prepend(option);
    const rebuilt = await step(documentRef, target, 500);

    expect(yearStep.safeSignals).toContain("financial-year-selected");
    for (const result of [firstLook, tooSoon, rebuilt]) {
      expect(result.state).not.toBe("candidate-not-found");
    }
    expect(rebuilt.safeSignals).toContain("quarter-selected");
  });

  it("selects the year first and never concludes from the other year's quarter list", async () => {
    const documentRef = dashboard({
      year: "2026-27",
      quarters: LIVE_QUARTERS,
      months: LIVE_MONTHS,
    });
    const target = scope("GSTR-1", "April");

    const first = await step(documentRef, target);

    expect(first.safeSignals).toContain("financial-year-selected");
    expect(first.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("starts the two looks again when the quarter appears in between", async () => {
    const documentRef = dashboard({
      year: "2025-26",
      quarters: LIVE_QUARTERS,
      months: LIVE_MONTHS,
    });
    const target = scope("GSTR-1", "April");

    const first = await step(documentRef, target);
    const quarter = documentRef.querySelector<HTMLSelectElement>("#quarter")!;
    const option = documentRef.createElement("option");
    option.textContent = "Quarter 1 (Apr - Jun)";
    quarter.prepend(option);
    const second = await step(documentRef, target);

    expect(first.safeSignals).toContain("gstr1-return-dashboard-period-not-offered-pending");
    expect(second.state).not.toBe("candidate-not-found");
    expect(second.safeSignals).toContain("quarter-selected");
    expect(quarter.value).toContain("Quarter 1");
  });

  it("keeps an offered period on the normal selection path", async () => {
    const documentRef = dashboard({
      year: "2025-26",
      quarters: LIVE_QUARTERS,
      months: LIVE_MONTHS,
    });
    const target = scope("GSTR-1", "July");

    const first = await step(documentRef, target);

    expect(first.safeSignals).toContain("quarter-selected");
    expect(first.safeSignals).not.toContain("gstr1-return-dashboard-period-not-offered-pending");
  });
});

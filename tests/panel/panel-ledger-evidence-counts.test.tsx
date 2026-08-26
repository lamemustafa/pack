import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createFullFiscalYearLedger,
  isFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));

import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { PANEL_TEST_SCOPE, panelController } from "./panel-controller.test-helpers";

describe("ledger-to-panel review counts", () => {
  it.each([
    { name: "blocked first period", notFiled: 0, interrupted: false },
    { name: "blocked after two not-filed periods", notFiled: 2, interrupted: false },
    { name: "interrupted active period", notFiled: 0, interrupted: true },
  ])("preserves explicit outcomes for $name", ({ notFiled, interrupted }) => {
    const createdAt = new Date("2026-08-25T00:00:00.000Z");
    const ledger = createFullFiscalYearLedger(PANEL_TEST_SCOPE, createdAt, FILED_RETURNS_MONTHS);
    ledger.status = interrupted ? "running" : "blocked";
    ledger.targets = ledger.targets.map((target, index) => {
      const status =
        index < notFiled
          ? "not-filed"
          : index === notFiled
            ? interrupted
              ? "running"
              : "blocked"
            : "pending";
      return {
        ...target,
        status,
        attempts: status === "pending" ? 0 : 1,
        ...canonicalDurableTargetStatus(
          target,
          status,
          status === "not-filed" ? ["filed-return-positively-not-filed"] : [],
        ),
      };
    });
    ledger.currentTargetId = ledger.targets[notFiled]!.targetId;
    expect(isFullFiscalYearLedger(ledger)).toBe(true);

    const summary = summariseFullFiscalYearLedger(
      ledger,
      new Date(createdAt.getTime() + (interrupted ? 60_000 : 0)),
    );
    expect(summary.status).toBe("blocked");
    expect(summary.completedPeriods).toHaveLength(notFiled);
    expect(summary.targetEvidence?.filter(({ outcome }) => outcome === "needs-review")).toEqual([
      { period: FILED_RETURNS_MONTHS[notFiled], outcome: "needs-review" },
    ]);

    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={panelController({
          scope: summary.scope,
          scopedFlowSummary: summary,
          recoverySummary: summary,
          lastRunSummary: summary,
          scopeLockedForReview: true,
        })}
      />,
    );

    expect(markup.match(/\b\d+ needs review/g)).toEqual(["1 needs review"]);
    expect(markup.match(/>Waiting</g)).toHaveLength(11 - notFiled);
    expect(markup.match(/>Not filed</g) ?? []).toHaveLength(notFiled);
    expect(markup).toContain("0 of 12 saved");
    expect(markup).not.toMatch(/\b\d+ ready\b/);
    expect(markup).not.toContain("saved by your browser");
  });
});

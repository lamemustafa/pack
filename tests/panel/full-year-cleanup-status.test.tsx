import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortalContext } from "../../src/core/contracts";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { markFullFiscalYearCleanupPending } from "../../src/background/filed-returns-full-fiscal-year-staging";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import {
  durableFiledReturnsSignalRejectionReason,
  isDurableFiledReturnsSignal,
} from "../../src/connectors/gst/filed-returns-durable-signals";
import {
  canRetryFullFiscalYearZipWithoutPortal,
  hasUnresolvedFiledReturnsRecovery,
} from "../../src/entrypoints/popup/flow-summary";
import { hasRecoveryActions } from "../../src/entrypoints/popup/recovery-actions";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
} from "../background/full-year-completion-fixtures.test-helpers";
import { panelController } from "./panel-controller.test-helpers";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));
import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";

const CLEANUP_CASES = [
  {
    phase: "downloaded-cleanup-pending",
    targetStatus: "downloaded",
    deliveryCopy: "One ZIP · saved by your browser",
    evidenceCopy: "1 of 12 saved",
  },
  {
    phase: "no-artifacts-cleanup-pending",
    targetStatus: "not-filed",
    deliveryCopy: "No ZIP created · no eligible files",
    evidenceCopy: "0 of 12 saved",
  },
  {
    phase: "legacy-cleanup-pending",
    targetStatus: "downloaded",
    deliveryCopy: "One ZIP · browser download not confirmed",
    evidenceCopy: "0 of 12 saved",
  },
] as const;

const CONTEXT_CASES = [
  { label: "no portal context", context: null },
  {
    label: "an unsupported context",
    context: { connectorId: "gst", pageKind: "unsupported", supported: false },
  },
] as const satisfies readonly { label: string; context: PortalContext | null }[];

describe.each(CLEANUP_CASES)(
  "whole-panel $phase warning",
  ({ phase, targetStatus, deliveryCopy, evidenceCopy }) => {
    const sources =
      phase === "legacy-cleanup-pending"
        ? (["direct producer", "parser round-trip"] as const)
        : (["direct producer"] as const);
    describe.each(sources)("%s", (source) => {
      it.each(CONTEXT_CASES)("stays visible with $label at the same scope", ({ context }) => {
        const completed = makeCompletedRecoveryLedger(targetStatus);
        expect(isFullFiscalYearLedger(completed)).toBe(true);
        const ledger = markFullFiscalYearCleanupPending(completed, RECOVERY_NOW, phase);
        expect(isFullFiscalYearLedger(ledger)).toBe(true);
        expect(ledger.zipPhase).toBe(phase);
        expect(ledger.currentTargetId).toBeUndefined();

        const produced = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
        const summary =
          source === "direct producer"
            ? produced
            : parseDurableFiledReturnsFlowSummary(JSON.parse(JSON.stringify(produced)));
        expect(summary).not.toBeNull();
        if (!summary) throw new Error("The accepted legacy summary must survive durable parsing.");
        expect(summary.status).toBe("blocked");
        expect(summary.completedPeriods).toHaveLength(12);
        expect(summary.totalPeriods).toBe(12);
        expect(summary.currentPeriod).toBeUndefined();
        expect(summary.fullFiscalYearRecovery).toBeUndefined();
        expect(summary.completedAt).toBeUndefined();
        expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-local-cleanup-retry");

        // Visibility must not grant target recovery or start-fresh authority.
        expect(canRetryFullFiscalYearZipWithoutPortal(summary)).toBe(true);
        expect(hasRecoveryActions(summary)).toBe(false);
        expect(hasUnresolvedFiledReturnsRecovery(summary)).toBe(false);

        const callbacks = {
          acknowledgeInterruptedRun: vi.fn(async () => undefined),
          refreshPortalContext: vi.fn(async () => undefined),
          resolveFullFiscalYearTarget: vi.fn(async () => undefined),
          resolveUnconfirmedDownload: vi.fn(async () => undefined),
          retryFiledReturnsTarget: vi.fn(async () => undefined),
          retryFullFiscalYearTarget: vi.fn(async () => undefined),
          setScope: vi.fn(),
          startFiledReturnsFlow: vi.fn(async () => undefined),
          startFreshFiledReturnsFlow: vi.fn(async () => undefined),
        };
        const markup = renderToStaticMarkup(
          <PanelSurface
            pack={panelController({
              ...callbacks,
              context,
              scope: summary.scope,
              scopedFlowSummary: summary,
              lastRunSummary: summary,
            })}
          />,
        );

        const warning = markup.match(/<section class="inline-status[^"]*"[\s\S]*?<\/section>/)?.[0];
        expect(warning).toBeDefined();
        expect(warning).toContain('aria-label="Saved run needs attention"');
        expect(warning).toContain('class="inline-status inline-status-warning"');
        expect(warning).toContain('aria-live="polite"');
        expect(warning).toContain(renderToStaticMarkup(<p>{summary.flowStep.safeMessage}</p>));
        expect(warning).not.toContain("<button");
        expect(markup).not.toContain("Saved run options");
        expect(markup).not.toContain("Download complete");
        expect(markup).not.toContain("12 periods saved as one ZIP");
        expect(markup).toContain(deliveryCopy);
        if (phase !== "downloaded-cleanup-pending") {
          expect(markup).not.toContain("saved by your browser");
        }

        if (source === "direct producer") {
          expect(markup).toContain('aria-label="Per-period result"');
          expect(markup).toContain(evidenceCopy);
          expect(markup.match(/>Not filed</g)).toHaveLength(
            phase === "no-artifacts-cleanup-pending" ? 12 : 11,
          );
          if (phase === "legacy-cleanup-pending") {
            expect(markup).toContain("1 captured, ZIP not confirmed");
          } else {
            expect(markup).not.toContain("captured, ZIP not confirmed");
          }
        } else {
          // The durable parser deliberately omits per-period display evidence.
          expect(summary.targetEvidence).toBeUndefined();
          expect(markup).not.toContain('aria-label="Per-period result"');
          expect(markup).not.toMatch(/\b\d+ of 12 saved\b/);
        }
        for (const callback of Object.values(callbacks)) {
          expect(callback).not.toHaveBeenCalled();
        }
      });
    });
  },
);

describe("existing cleanup summary persistence boundary", () => {
  it.each(CLEANUP_CASES.filter(({ phase }) => phase !== "legacy-cleanup-pending"))(
    "preserves a blocked durable round-trip for $phase",
    ({ phase, targetStatus }) => {
      const completed = makeCompletedRecoveryLedger(targetStatus);
      expect(isFullFiscalYearLedger(completed)).toBe(true);
      const ledger = markFullFiscalYearCleanupPending(completed, RECOVERY_NOW, phase);
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);

      expect(
        summary.flowStep.safeSignals.filter((signal) => !isDurableFiledReturnsSignal(signal)),
      ).toEqual([]);
      expect(durableFiledReturnsSignalRejectionReason(summary.flowStep.safeSignals)).toBeNull();
      expect(
        parseDurableFiledReturnsFlowSummary(JSON.parse(JSON.stringify(summary))),
      ).toMatchObject({
        status: "blocked",
        completedPeriods: completed.targets.map((target) => target.period),
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining([`full-fiscal-year-zip-phase:${phase}`]),
        },
      });
    },
  );
});

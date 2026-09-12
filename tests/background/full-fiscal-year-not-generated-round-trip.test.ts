import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (key?: unknown) => {
        if (typeof key === "string") return { [key]: stored.current[key] };
        return stored.current;
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete stored.current[key];
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(stored.current, values);
      }),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

import {
  hasTerminalPositiveTarget,
  persistLedger,
  readPlanLedgersStorageState,
} from "../../src/background/filed-returns-full-fiscal-year-run-state";
import {
  createFullFiscalYearLedger,
  markFullFiscalYearTargetRunning,
  markFullFiscalYearTargetTerminal,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { exportFullFiscalYearZip } from "../../src/background/filed-returns-full-fiscal-year-zip";
import { declinedArtifactSafeMessage } from "../../src/connectors/gst/filed-returns-declined-artifact";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";

const deps = {
  storageKeys: { fullFiscalYearLedger: "legacy", fullFiscalYearLedgerIndex: "index" },
};

const scope: FiledReturnsDownloadScope = {
  financialYear: "2025-26",
  period: "FULL_FISCAL_YEAR",
  returnType: "GSTR-2B",
  artifactType: "PDF_AND_EXCEL",
};

// A synthetic terminal refusal establishes that this target has no artifact to stage. It is a
// resolved absence, not a transient download failure.
function notGeneratedStep() {
  return {
    connectorId: "gst" as const,
    scopeId: "gst-gstr2b-private-v0",
    state: "blocked" as const,
    safeSignals: [
      "gstr2b-summary-route",
      "filed-gstr2b-not-generated",
      "gstr2b-summary-route-verified",
      "gstr2b-visible-period-verified",
    ],
    safeMessage: declinedArtifactSafeMessage("filed-gstr2b-not-generated"),
  };
}

describe("a full-year run whose period the portal never generated", () => {
  beforeEach(() => {
    stored.current = {};
    vi.clearAllMocks();
  });

  it("can still read back the plan it just saved", async () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    let ledger = createFullFiscalYearLedger(scope, now, ["April", "May"]);
    const april = ledger.targets[0]!.targetId;

    ledger = markFullFiscalYearTargetRunning(ledger, april, now);
    await persistLedger(deps, ledger);

    ledger = markFullFiscalYearTargetTerminal(
      ledger,
      april,
      "not-generated",
      notGeneratedStep(),
      now,
    );
    expect(ledger.targets[0]!.status).toBe("not-generated");
    // A terminal state must say what actually happened. The generic review copy sent the user to
    // browser Downloads to look for a file the portal had just said it never produced.
    expect(ledger.targets[0]!.safeMessage).toContain("did not generate");
    expect(ledger.targets[0]!.safeMessage).not.toContain("Check Downloads");
    await persistLedger(deps, ledger);

    // The observable failure: the saved plan came back unreadable, so the very next persist threw
    // out of the background message handler and the run's details vanished from the panel.
    expect(await readPlanLedgersStorageState(deps)).toMatchObject({ state: "valid" });
    await expect(persistLedger(deps, ledger)).resolves.toBeUndefined();
  });

  it("does not block its ZIP on an artifact the portal never produced", async () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    let ledger = createFullFiscalYearLedger(scope, now, ["April"]);
    const april = ledger.targets[0]!.targetId;
    ledger = markFullFiscalYearTargetRunning(ledger, april, now);
    ledger = markFullFiscalYearTargetTerminal(
      ledger,
      april,
      "not-generated",
      notGeneratedStep(),
      now,
    );

    const completeStep = {
      connectorId: "gst" as const,
      scopeId: "gst-gstr2b-private-v0",
      state: "downloaded" as const,
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Pack completed the local full fiscal year run.",
    };

    const step = await exportFullFiscalYearZip(ledger, completeStep);

    // The planner must not count a resolved absence as an artifact it failed to stage.
    expect(step.safeSignals).not.toContain("full-fiscal-year-zip-artifact-staging-incomplete");
    expect(step.safeSignals).toContain("full-fiscal-year-no-zip-artifacts");
    expect(step.state).not.toBe("blocked");
  });
});

describe("a cancelled run that recorded a declined period", () => {
  // The guard that decides whether a cancelled run may be silently replaced listed `not-filed` but
  // not `not-generated`. Both are the portal answering that there is nothing to download, so a run
  // holding one was protected and a run holding the other was not.
  it("counts as work the run must not discard without asking", () => {
    const now = new Date("2026-09-11T00:00:00.000Z");
    let ledger = createFullFiscalYearLedger(scope, now, ["April", "May"]);
    const april = ledger.targets[0]!.targetId;
    ledger = markFullFiscalYearTargetRunning(ledger, april, now);
    ledger = markFullFiscalYearTargetTerminal(
      ledger,
      april,
      "not-generated",
      notGeneratedStep(),
      now,
    );

    expect(hasTerminalPositiveTarget(ledger)).toBe(true);
  });
});

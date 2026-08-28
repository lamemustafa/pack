import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../src/connectors/gst/filed-returns-contracts";
import { RECOVERY_SCOPE } from "../background/full-year-completion-fixtures.test-helpers";
import {
  CLEANUP_ACTION_CASES,
  makeCleanupActionSummary,
  makeContradictoryCleanupSummary,
  makeZipActionSummary,
} from "./full-year-cleanup-fixtures.test-helpers";

vi.mock("wxt/browser", () => ({ browser: {} }));
import { ScopeFormAction } from "../../src/entrypoints/popup/components";

const CHECKING_BODY = "Pack is checking the saved run before retrying local cleanup.";
const PORTAL_COPY =
  "Keep GST Portal visible in the foreground while Pack creates one ZIP for all eligible periods.";

function actionMarkup(
  summary: FiledReturnsFlowSummary | null,
  busy: string | null = null,
  options: {
    scope?: FiledReturnsDownloadScope;
    supported?: boolean;
    externalBlock?: { disabled: true; label: string };
  } = {},
) {
  const onStart = vi.fn();
  const markup = renderToStaticMarkup(
    <ScopeFormAction
      busy={busy}
      context={{
        connectorId: "gst",
        pageKind: "unsupported",
        supported: options.supported ?? false,
      }}
      flowSummary={summary}
      scope={options.scope ?? summary?.scope ?? RECOVERY_SCOPE}
      externalBlock={options.externalBlock ?? null}
      onStart={onStart}
    />,
  );
  expect(onStart).not.toHaveBeenCalled();
  return markup;
}

function button(markup: string) {
  const value = markup.match(/<button[\s\S]*?<\/button>/)?.[0];
  expect(value).toBeDefined();
  return value!;
}

describe.each(CLEANUP_ACTION_CASES)("$name action copy", (testCase) => {
  it("names local cleanup without requiring a supported portal", () => {
    const markup = actionMarkup(makeCleanupActionSummary(testCase));
    expect(button(markup)).toContain(">Retry local cleanup</button>");
    expect(button(markup)).not.toContain("disabled");
    expect(markup).toContain("Retry cleanup for this saved run.");
    expect(markup).not.toContain(PORTAL_COPY);
    expect(markup).not.toContain("Open GST Portal");
  });

  it("describes a pending Start as a saved-run check, not a confirmed cleanup", () => {
    const markup = actionMarkup(makeCleanupActionSummary(testCase), "start-filed-returns-flow");
    expect(button(markup)).toContain(">Checking saved run</button>");
    expect(button(markup)).toContain('disabled=""');
    expect(markup).toContain(CHECKING_BODY);
    expect(markup).not.toContain("Waiting for Chrome");
    expect(markup).not.toContain("Downloading...");
  });
});

describe("cleanup copy preserves other action decisions", () => {
  it("matches an omitted artifact to its default PDF selection", () => {
    const summary = makeCleanupActionSummary();
    const scope = { ...summary.scope };
    delete scope.artifactType;
    const markup = actionMarkup(summary, null, { scope });
    expect(button(markup)).toContain(">Retry local cleanup</button>");
    expect(button(markup)).not.toContain("disabled");
  });

  it.each(["April", RECOVERY_SCOPE.period])("keeps ordinary %s download copy", (period) => {
    const scope = { ...RECOVERY_SCOPE, period };
    const idle = actionMarkup(null, null, { scope, supported: true });
    expect(button(idle)).toContain(">Download ");
    expect(button(idle)).not.toContain("disabled");
    expect(idle).toContain(
      period === "April" ? "Download one period from the active GST tab." : PORTAL_COPY,
    );
    const pending = actionMarkup(null, "start-filed-returns-flow", { scope, supported: true });
    expect(button(pending)).toContain(">Downloading...</button>");
    expect(button(pending)).toContain('disabled=""');
    expect(pending).toContain("Waiting for Chrome to save the file.");
  });

  it.each(["export-pending", "export-retry-pending"] as const)(
    "keeps ordinary %s retry and busy copy",
    (phase) => {
      const summary = makeZipActionSummary(phase);
      const idle = actionMarkup(summary);
      expect(button(idle)).toContain(">Retry final ZIP</button>");
      expect(button(idle)).not.toContain("disabled");
      expect(idle).toContain(PORTAL_COPY);
      const pending = actionMarkup(summary, "start-filed-returns-flow");
      expect(button(pending)).toContain(">Downloading...</button>");
      expect(button(pending)).toContain('disabled=""');
      expect(pending).toContain("Waiting for Chrome to save the file.");
    },
  );

  it.each([
    ["download-started", "I checked—retry final ZIP"],
    ["download-intent-persisted", "I checked—retry final ZIP"],
    ["download-observing", "Check final ZIP status"],
  ] as const)("keeps %s precedence over an added cleanup marker", (phase, label) => {
    const summary = makeZipActionSummary(phase);
    summary.flowStep.safeSignals.push("full-fiscal-year-local-cleanup-retry");
    const idle = actionMarkup(summary);
    expect(button(idle)).toContain(`>${label}</button>`);
    expect(button(idle)).not.toContain("disabled");
    expect(idle).not.toContain("Retry cleanup for this saved run.");
    const pending = actionMarkup(summary, "start-filed-returns-flow");
    expect(button(pending)).toContain(">Downloading...</button>");
    expect(pending).not.toContain(CHECKING_BODY);
  });

  it.each([null, "start-filed-returns-flow"])(
    "does not borrow cleanup copy across scopes (%s)",
    (busy) => {
      const summary = makeCleanupActionSummary();
      const markup = actionMarkup(summary, busy, {
        scope: { ...summary.scope, financialYear: "2024-25" },
      });
      expect(markup).not.toContain("Retry local cleanup");
      expect(markup).not.toContain("Retry cleanup for this saved run.");
      expect(markup).not.toContain(CHECKING_BODY);
      // Preserve the existing unscoped portal-independence decision for direct props.
      expect(button(markup).includes('disabled=""')).toBe(busy !== null);
      expect(button(markup)).toContain(
        busy ? ">Downloading...</button>" : ">Download all 2024-25 ",
      );
    },
  );

  it("keeps an external refusal authoritative", () => {
    const markup = actionMarkup(makeCleanupActionSummary(), null, {
      externalBlock: { disabled: true, label: "Resolve the paused run first" },
    });
    expect(button(markup)).toContain(">Resolve the paused run first</button>");
    expect(button(markup)).toContain('disabled=""');
    expect(markup).not.toContain("Retry cleanup for this saved run.");
  });

  it("does not describe an unrelated busy action as checking cleanup", () => {
    const markup = actionMarkup(makeCleanupActionSummary(), "retry-filed-returns-target");
    expect(button(markup)).toContain(">Download all 2025-26 ");
    expect(button(markup)).toContain('disabled=""');
    expect(markup).not.toContain("Checking saved run");
    expect(markup).not.toContain(CHECKING_BODY);
  });

  it.each(["current period", "target recovery", "both"] as const)(
    "does not classify contradictory %s props as cleanup",
    (contradiction) => {
      const summary = makeContradictoryCleanupSummary(contradiction);
      const idle = actionMarkup(summary);
      expect(button(idle)).toContain(">Retry final ZIP</button>");
      expect(button(idle)).not.toContain("disabled");
      expect(idle).not.toContain("Retry cleanup for this saved run.");
      const pending = actionMarkup(summary, "start-filed-returns-flow");
      expect(button(pending)).toContain(">Downloading...</button>");
      expect(pending).not.toContain(CHECKING_BODY);
    },
  );

  it.each([
    "missing retained marker",
    "missing cleanup marker",
    "complete status",
    "single period",
    "target review",
  ] as const)("does not classify %s as cleanup or change its eligibility", (variant) => {
    const summary = makeCleanupActionSummary();
    if (variant === "missing retained marker" || variant === "missing cleanup marker") {
      const removed =
        variant === "missing retained marker"
          ? "full-fiscal-year-opfs-retained"
          : "full-fiscal-year-local-cleanup-retry";
      summary.flowStep.safeSignals = summary.flowStep.safeSignals.filter(
        (signal) => signal !== removed,
      );
    } else if (variant === "complete status") {
      summary.status = "complete";
    } else if (variant === "single period") {
      summary.scope = { ...summary.scope, period: "April" };
    } else {
      summary.flowStep.safeSignals.push("filed-returns-target-review-required");
    }
    const idle = actionMarkup(summary);
    expect(idle).not.toContain("Retry local cleanup");
    expect(idle).not.toContain("Retry cleanup for this saved run.");
    expect(button(idle).includes('disabled=""')).toBe(variant !== "target review");
    if (variant === "target review") expect(button(idle)).toContain(">Retry final ZIP</button>");
    const pending = actionMarkup(summary, "start-filed-returns-flow");
    expect(button(pending)).toContain(">Downloading...</button>");
    expect(button(pending)).toContain('disabled=""');
    expect(pending).not.toContain(CHECKING_BODY);
  });
});

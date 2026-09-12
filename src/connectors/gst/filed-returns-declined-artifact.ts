import type { PortalDownloadTriggerResult } from "../../core/contracts";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
} from "./filed-returns-contracts";
import {
  DECLINED_ARTIFACT_SIGNALS,
  type DeclinedArtifactSignal,
} from "./filed-returns-acquisition-diagnostics";
import { normaliseFiledReturnsArtifactType } from "./filed-returns-artifacts";
import { FULL_FISCAL_YEAR_PERIOD } from "./filed-returns-scope";
import { verifyFiledReturnsDownloadTarget } from "./filed-returns-download-target";
import { filedReturnScopeId } from "./filed-returns-return-descriptors";
import { isGstr2bSummaryRoute, verifyVisibleGstr2bPeriod } from "./gstr2b-summary";

// Recording a refusal resolves a target outright: the period is answered, the run advances, and
// no artifact ever follows to corroborate it. The visible page is therefore the whole of the
// evidence, and a refusal read from a page that was never checked against the target is a wrong
// answer that looks exactly like a right one.
//
// Three emitters each learned that separately, one reported defect at a time, and nothing stopped
// a fourth from not learning it. So the check is no longer something an emitter remembers to do:
// a declined result cannot be constructed without presenting proof that it was done.

declare const boundToVisibleTarget: unique symbol;

/**
 * Proof that the visible page was checked against the target this refusal is about.
 *
 * The brand is a type-only symbol declared here and exported nowhere, so no object literal
 * written in another module satisfies this interface and no emitter can reach
 * `declinedArtifactStep` without first having run a guard below. A deliberate
 * `as unknown as VisibleTargetBinding` would still get through -- this makes the check
 * impossible to *forget*, which is how all four of these defects happened, not impossible to
 * circumvent on purpose.
 */
export interface VisibleTargetBinding<
  Signal extends DeclinedArtifactSignal,
  ReturnType extends FiledReturnsDownloadScope["returnType"],
> {
  readonly [boundToVisibleTarget]: true;
  /** The portal answer this proof may construct. */
  readonly signal: Signal;
  /** The target family the proof was bound against. */
  readonly returnType: ReturnType;
  /** What the guard established, carried into the result so the record says how it was checked. */
  readonly safeSignals: readonly RefusalBindingSignal[];
}

/**
 * What each binder establishes, named so the durable record says *how* the refusal was checked.
 *
 * Registered by derivation rather than by hand: the durable allowlist spreads this list, so a new
 * binder's signal is admitted the moment it is written here. One unregistered token rejects the
 * entire array it travels in, and a refusal is a terminal step whose signals are persisted --
 * so a terminal refusal remains readable after persistence.
 */
const DECLINED_ARTIFACT_BINDING_SIGNALS = {
  "filed-gstr1-excel-no-details-available": ["filed-gstr1-detail-period-verified"],
  "filed-gstr2b-not-generated": ["gstr2b-summary-route-verified", "gstr2b-visible-period-verified"],
} as const;

export const REFUSAL_BINDING_SIGNALS = [
  ...DECLINED_ARTIFACT_BINDING_SIGNALS["filed-gstr1-excel-no-details-available"],
  ...DECLINED_ARTIFACT_BINDING_SIGNALS["filed-gstr2b-not-generated"],
] as const;

export function getBoundDeclinedArtifactSignal(
  scope: FiledReturnsDownloadScope,
  safeSignals: readonly string[],
): DeclinedArtifactSignal | null {
  if (
    scope.period === FULL_FISCAL_YEAR_PERIOD ||
    safeSignals.includes("filed-return-positively-not-filed")
  )
    return null;
  const signals = DECLINED_ARTIFACT_SIGNALS.filter((signal) => safeSignals.includes(signal));
  if (signals.length !== 1) return null;
  const signal = signals[0]!;
  const requiredProofs: readonly string[] = DECLINED_ARTIFACT_BINDING_SIGNALS[signal];
  if (
    REFUSAL_BINDING_SIGNALS.some(
      (proof) => safeSignals.includes(proof) && !requiredProofs.includes(proof),
    )
  )
    return null;
  const compatibleScope =
    signal === "filed-gstr1-excel-no-details-available"
      ? scope.returnType === "GSTR-1" &&
        normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType) === "EXCEL"
      : scope.returnType === "GSTR-2B";
  return compatibleScope && requiredProofs.every((proof) => safeSignals.includes(proof))
    ? signal
    : null;
}

export type RefusalBindingSignal = (typeof REFUSAL_BINDING_SIGNALS)[number];

export type RefusalBinding<
  Signal extends DeclinedArtifactSignal,
  ReturnType extends FiledReturnsDownloadScope["returnType"],
> =
  | { readonly bound: VisibleTargetBinding<Signal, ReturnType> }
  | { readonly bound: null; readonly mismatch: PortalDownloadTriggerResult };

// The brand exists only in the type system, so it is asserted rather than written. This is the
// one place allowed to make that assertion, which is what the brand is for.
function bound<
  Signal extends DeclinedArtifactSignal,
  ReturnType extends FiledReturnsDownloadScope["returnType"],
>(
  signal: Signal,
  returnType: ReturnType,
  safeSignals: readonly RefusalBindingSignal[],
): RefusalBinding<Signal, ReturnType> {
  return {
    bound: { signal, returnType, safeSignals } as unknown as VisibleTargetBinding<
      Signal,
      ReturnType
    >,
  };
}

function incompatibleScope(
  returnType: FiledReturnsDownloadScope["returnType"],
): PortalDownloadTriggerResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(returnType),
    state: "blocked",
    safeSignals: ["page-target-unverified"],
    safeMessage: "Pack could not bind this portal refusal to the requested return type.",
  };
}

/**
 * The filed GSTR-1 detail route, against the target whose artifact was declined.
 *
 * The same guard that binds a download click on that page, asked the same question: this return
 * type, this period, this financial year, as the page itself shows them. It fails closed -- an
 * unreadable detail header is "could not determine", never "matches".
 */
export function bindGstr1DetailRefusal(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
): RefusalBinding<"filed-gstr1-excel-no-details-available", "GSTR-1"> {
  if (target.returnType !== "GSTR-1" || target.artifactType !== "EXCEL")
    return { bound: null, mismatch: incompatibleScope(target.returnType) };
  const mismatch = verifyFiledReturnsDownloadTarget(documentRef, target, []);
  return mismatch
    ? { bound: null, mismatch }
    : bound(
        "filed-gstr1-excel-no-details-available",
        "GSTR-1",
        DECLINED_ARTIFACT_BINDING_SIGNALS["filed-gstr1-excel-no-details-available"],
      );
}

/**
 * The GSTR-2B summary route, against the period whose statement the portal declined to draft.
 *
 * Visible evidence is required rather than accepted from the page's own inline configuration:
 * a download click may lean on that configuration because the file it produces is correlated to
 * the target afterwards, and a refusal has no such second source.
 */
export function bindGstr2bSummaryRefusal(
  documentRef: Document,
  normalisedText: string,
  scope: FiledReturnsDownloadScope,
): RefusalBinding<"filed-gstr2b-not-generated", "GSTR-2B"> {
  if (scope.returnType !== "GSTR-2B")
    return { bound: null, mismatch: incompatibleScope(scope.returnType) };
  if (!isGstr2bSummaryRoute(documentRef)) {
    return {
      bound: null,
      mismatch: {
        connectorId: "gst",
        scopeId: filedReturnScopeId("GSTR-2B"),
        state: "blocked",
        safeSignals: ["page-target-unverified"],
        safeMessage:
          "Pack could not verify that this portal refusal is on the GSTR-2B summary page.",
      },
    };
  }
  const mismatch = verifyVisibleGstr2bPeriod(documentRef, normalisedText, scope, true);
  return mismatch
    ? { bound: null, mismatch }
    : bound(
        "filed-gstr2b-not-generated",
        "GSTR-2B",
        DECLINED_ARTIFACT_BINDING_SIGNALS["filed-gstr2b-not-generated"],
      );
}

/**
 * What a reader is told when the portal declines, and what Pack offers them to do about it.
 *
 * A `Record` over the declined signals, so a third refusal cannot be registered without deciding
 * both. The GSTR-2B wording lived in two places before this and was identical in both, which is
 * the duplicate nothing could contradict: no test compares one emitter's copy with another's.
 */
const DECLINED_ARTIFACT_COPY: Readonly<
  Record<DeclinedArtifactSignal, { safeMessage: string; userActionMessage: string }>
> = {
  "filed-gstr1-excel-no-details-available": {
    safeMessage:
      "The GST Portal reported that no e-invoice details are available for this filed GSTR-1 period, so Pack did not record an Excel download. Retry after e-invoice details are available, or run PDF-only for this period.",
    userActionMessage:
      "Close the GST Portal information dialog, then retry the GSTR-1 Excel download after e-invoice details are available.",
  },
  "filed-gstr2b-not-generated": {
    safeMessage:
      "The GST Portal reported that it did not generate the auto-drafted GSTR-2B statement for this period, so there is nothing for Pack to download. Pack recorded the period as unavailable rather than retrying.",
    userActionMessage:
      "Check the GST Portal's stated reason for this period. Retry only once the portal generates a GSTR-2B for it.",
  },
};

/** The wording a reader is given, for the durable record that outlives the flow step. */
export function declinedArtifactSafeMessage(signal: DeclinedArtifactSignal): string {
  return DECLINED_ARTIFACT_COPY[signal].safeMessage;
}

/**
 * The only way to build a declined-artifact result, and it takes the proof as its first argument.
 *
 * Always `blocked`: this records an absence the portal stated, never a download. Completion still
 * requires correlated download evidence, which an absence by definition does not have.
 */
export function declinedArtifactStep<
  Signal extends DeclinedArtifactSignal,
  ReturnType extends FiledReturnsDownloadScope["returnType"],
>(
  binding: VisibleTargetBinding<Signal, ReturnType>,
  options: { safeSignals: readonly string[] },
): PortalDownloadTriggerResult {
  const copy = DECLINED_ARTIFACT_COPY[binding.signal];
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(binding.returnType),
    state: "blocked",
    safeSignals: Array.from(
      new Set([...options.safeSignals, ...binding.safeSignals, binding.signal]),
    ),
    safeMessage: copy.safeMessage,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: copy.userActionMessage,
      canResume: true,
    },
  };
}

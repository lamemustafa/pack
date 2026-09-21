import { browser } from "wxt/browser";

/**
 * QUALIFICATION PROBE (#386) -- not for merge.
 *
 * Records how long the portal takes to hand back a generated artifact after Pack clicks its
 * control, so the generation timeout can be set from measurements instead of a guess. Session
 * storage only (cleared when the browser exits); no year, period, GSTIN, filename or file data.
 */
const KEY = "pack:qualification-portal-generation-timings";
const LIMIT = 200;

export async function recordPortalGenerationTiming(entry: {
  returnType: string;
  artifactType: string;
  outcome: string;
  elapsedMs: number;
}): Promise<void> {
  try {
    const stored = (await browser.storage.session.get(KEY))[KEY];
    const timings = Array.isArray(stored) ? stored : [];
    timings.push({ ...entry, elapsedMs: Math.round(entry.elapsedMs) });
    await browser.storage.session.set({ [KEY]: timings.slice(-LIMIT) });
  } catch {
    // A probe must never change the flow it measures.
  }
}

const FILTER_KEY = "pack:qualification-filter-diagnostics";

/** QUALIFICATION PROBE -- keeps the probe's own `qual-` signals from each flow step. */
export async function recordQualificationStepSignals(step: {
  state: string;
  safeSignals: readonly string[];
}): Promise<void> {
  const qual = step.safeSignals.filter((signal) => signal.startsWith("qual-"));
  if (qual.length === 0) return;
  try {
    const stored = (await browser.storage.session.get(FILTER_KEY))[FILTER_KEY];
    const entries = Array.isArray(stored) ? stored : [];
    entries.push({ at: new Date().toISOString(), state: step.state, signals: step.safeSignals });
    await browser.storage.session.set({ [FILTER_KEY]: entries.slice(-40) });
  } catch {
    // A probe must never change the flow it measures.
  }
}

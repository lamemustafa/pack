import { LIVE_RUN_SENSITIVE_PATTERN_DEFINITIONS } from "./live-run-evidence-redaction-patterns.mjs";

export const LIVE_RUN_SENSITIVE_PATTERNS: Array<{ id: string; pattern: RegExp }> =
  LIVE_RUN_SENSITIVE_PATTERN_DEFINITIONS.map(({ id, pattern, flags }) => ({
    id,
    pattern: new RegExp(pattern, flags),
  }));

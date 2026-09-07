import { normaliseText } from "./filed-returns-dom";

// GST Portal result-surface loading vocabulary. Keep the pattern private so callers
// cannot reinterpret it with a stateful global RegExp.
const FILED_RETURNS_LOADING_TEXT_PATTERN =
  /\bloading\b|\bplease\s+wait\b|\bsearching\b|\bprocessing\b/;

export function hasFiledReturnsLoadingText(text: string): boolean {
  return FILED_RETURNS_LOADING_TEXT_PATTERN.test(normaliseText(text));
}

export function countFiledReturnsLoadingTextOccurrences(text: string): number {
  return (
    normaliseText(text).match(new RegExp(FILED_RETURNS_LOADING_TEXT_PATTERN.source, "g")) ?? []
  ).length;
}

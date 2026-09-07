/** Fixed copy reconstructed from the existing categorical selection evidence. */
export function filedReturnsFilterActionRequiredMessage(signals: readonly string[]): string {
  const fields = [
    ["financial-year-selected", "financial year"],
    ["period-selected", "filing period"],
    ["month-selected", "month selection (if shown)"],
    ["return-type-selected", "return type"],
  ] as const;
  const unconfirmed = fields
    .filter(([signal]) => !signals.includes(signal))
    .map(([, label]) => label);
  const context = unconfirmed.length ? ` Not confirmed: ${unconfirmed.join(", ")}.` : "";
  return `Pack could not confirm that the filed-return filters had finished updating.${context} Check the portal filters and Search manually, then start Pack again.`;
}

/**
 * The filters were selected; Pack ran out of acquisition budget before it could press
 * the portal's own Search. Distinct from the message above, which reports the opposite
 * case — selection that never finished. Canonical so the runtime step and the persisted
 * summary state one reason rather than two.
 */
export const FILED_RETURNS_FILTER_DEADLINE_EXPIRED_MESSAGE =
  "Pack selected the filed-return filters but ran out of time before it could search. Start Pack again.";

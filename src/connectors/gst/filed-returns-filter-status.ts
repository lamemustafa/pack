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

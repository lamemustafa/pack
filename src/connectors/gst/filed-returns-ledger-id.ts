export type FiledReturnsLedgerKind = "full-fiscal-year" | "single-period";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FALLBACK_SUFFIX_PATTERN = /^[a-f0-9]{20}$/;
const LEGACY_FULL_FISCAL_YEAR_PATTERN = /^full-fiscal-year-[0-9a-z]{8}$/;
const LEGACY_SINGLE_PERIOD_SUFFIX_PATTERN = /^[0-9a-z]{8}-[0-9a-z]{1,10}$/;

export function createFiledReturnsLedgerId(kind: FiledReturnsLedgerKind, now = new Date()): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  const suffix = randomId ?? fallbackOpaqueSuffix(now);
  return kind === "single-period" ? `single-period:${suffix}` : suffix;
}

export function isCanonicalFiledReturnsLedgerId(value: unknown): value is string {
  return isCanonicalFullFiscalYearLedgerId(value) || isCanonicalSinglePeriodLedgerId(value);
}

export function isCanonicalFullFiscalYearLedgerId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return (
    UUID_PATTERN.test(value) ||
    FALLBACK_SUFFIX_PATTERN.test(value) ||
    LEGACY_FULL_FISCAL_YEAR_PATTERN.test(value)
  );
}

export function isCanonicalSinglePeriodLedgerId(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("single-period:")) return false;
  const suffix = value.slice("single-period:".length);
  return (
    UUID_PATTERN.test(suffix) ||
    FALLBACK_SUFFIX_PATTERN.test(suffix) ||
    LEGACY_SINGLE_PERIOD_SUFFIX_PATTERN.test(suffix)
  );
}

function fallbackOpaqueSuffix(now: Date): string {
  const timestamp = now.getTime().toString(16).padStart(12, "0").slice(-12);
  const random = Math.floor(Math.random() * 0x1_0000_0000)
    .toString(16)
    .padStart(8, "0");
  return `${timestamp}${random}`;
}

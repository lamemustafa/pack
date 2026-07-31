const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_ACTION_ID_PATTERN = /^action-[0-9a-z]{8}-[0-9a-z]{1,8}$/;
const LEGACY_RUN_ID_PATTERN = /^filed-returns-run-[0-9a-z]{8}$/;

export function isCanonicalFiledReturnsActionId(value: unknown): value is string {
  return (
    typeof value === "string" && (UUID_PATTERN.test(value) || LEGACY_ACTION_ID_PATTERN.test(value))
  );
}

export function isCanonicalFiledReturnsRunId(value: unknown): value is string {
  return (
    typeof value === "string" && (UUID_PATTERN.test(value) || LEGACY_RUN_ID_PATTERN.test(value))
  );
}

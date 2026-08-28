import {
  isFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "./filed-returns-artifacts";
import {
  FILED_RETURNS_SELECTED_TARGETS_KIND,
  type FiledReturnsSelectedTarget,
  type FiledReturnsSelectedTargetsRequest,
} from "./filed-returns-contracts";
import { FILED_RETURNS_RETURN_TYPES, isFiledReturnsReturnType } from "./filed-returns-return-types";
import {
  FILED_RETURNS_MONTHS,
  isFiledReturnsFinancialYear,
  type FiledReturnsMonth,
} from "./filed-returns-scope";

/** One chosen matrix cell per supported return and fiscal month. */
export const MAX_SELECTED_FILED_RETURNS_TARGETS =
  FILED_RETURNS_RETURN_TYPES.length * FILED_RETURNS_MONTHS.length;

/**
 * Builds the matrix root in one canonical order. The runner is deliberately
 * not part of this module: a selection is not authority to replay or fan out
 * browser actions until that runner has durably persisted the exact snapshot.
 */
export function createSelectedFiledReturnsTargetsRequest(
  financialYear: string,
  targets: readonly FiledReturnsSelectedTarget[],
): FiledReturnsSelectedTargetsRequest | null {
  if (!isFiledReturnsFinancialYear(financialYear)) return null;
  const canonicalTargets = canonicalSelectedTargets(targets);
  if (!canonicalTargets) return null;
  return {
    kind: FILED_RETURNS_SELECTED_TARGETS_KIND,
    financialYear,
    targets: canonicalTargets,
  };
}

export function isSelectedFiledReturnsTargetsRequest(
  input: unknown,
): input is FiledReturnsSelectedTargetsRequest {
  if (!isRecord(input) || !hasOnlyKeys(input, ["kind", "financialYear", "targets"])) return false;
  if (
    input.kind !== FILED_RETURNS_SELECTED_TARGETS_KIND ||
    !isFiledReturnsFinancialYear(input.financialYear) ||
    !Array.isArray(input.targets)
  ) {
    return false;
  }
  const canonicalTargets = canonicalSelectedTargets(input.targets);
  return (
    canonicalTargets !== null &&
    sameSelectedTargets(canonicalTargets, input.targets as readonly FiledReturnsSelectedTarget[])
  );
}

function canonicalSelectedTargets(
  input: readonly unknown[],
): readonly FiledReturnsSelectedTarget[] | null {
  if (input.length === 0 || input.length > MAX_SELECTED_FILED_RETURNS_TARGETS) return null;
  if (!input.every(isSelectedTarget)) return null;
  const targets = input.map((target) => ({ ...target }));
  targets.sort(compareSelectedTargets);
  return new Set(targets.map(selectedTargetKey)).size === targets.length ? targets : null;
}

function isSelectedTarget(input: unknown): input is FiledReturnsSelectedTarget {
  if (!isRecord(input) || !hasOnlyKeys(input, ["returnType", "period", "artifactType"]))
    return false;
  return (
    isFiledReturnsReturnType(input.returnType) &&
    isFiledReturnsMonth(input.period) &&
    isFiledReturnsArtifactType(input.artifactType) &&
    supportsFiledReturnsArtifactType(input.returnType, input.artifactType)
  );
}

function compareSelectedTargets(
  left: FiledReturnsSelectedTarget,
  right: FiledReturnsSelectedTarget,
) {
  return (
    left.returnType.localeCompare(right.returnType) ||
    FILED_RETURNS_MONTHS.indexOf(left.period) - FILED_RETURNS_MONTHS.indexOf(right.period) ||
    left.artifactType.localeCompare(right.artifactType)
  );
}

function selectedTargetKey(target: FiledReturnsSelectedTarget): string {
  // The matrix picks a period, not parallel formats for that same period. A
  // second artifact selection would overlap the first target's portal action
  // or concrete artifact set, so reject it before durable persistence.
  return `${target.returnType}:${target.period}`;
}

function sameSelectedTargets(
  left: readonly FiledReturnsSelectedTarget[],
  right: readonly FiledReturnsSelectedTarget[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (target, index) =>
        target.returnType === right[index]?.returnType &&
        target.period === right[index]?.period &&
        target.artifactType === right[index]?.artifactType,
    )
  );
}

function isFiledReturnsMonth(input: unknown): input is FiledReturnsMonth {
  return typeof input === "string" && FILED_RETURNS_MONTHS.includes(input as FiledReturnsMonth);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

import type { FlatJsonArrayExpansionOptions } from "../../core/json-flat-table";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export const MAX_FILED_RETURNS_SUMMARY_ARRAY_EXPANSION_ELEMENTS = 64;

const DISCRIMINATOR_KEYS = ["ty", "pos"] as const;
const GSTR3B_EXPANDABLE_ARRAY_PATHS = [
  "/itc_elg/itc_avl",
  "/itc_elg/itc_rev",
  "/itc_elg/itc_inelg",
  "/inter_sup/unreg_details",
] as const;

export function filedReturnsSummaryArrayExpansion(
  returnType: FiledReturnsReturnType,
): FlatJsonArrayExpansionOptions {
  return {
    discriminatorKeys: DISCRIMINATOR_KEYS,
    eligiblePaths: returnType === "GSTR-3B" ? GSTR3B_EXPANDABLE_ARRAY_PATHS : [],
    maxElements: MAX_FILED_RETURNS_SUMMARY_ARRAY_EXPANSION_ELEMENTS,
  };
}

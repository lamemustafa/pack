import { describe, expect, it } from "vitest";
import {
  FILED_RETURNS_PERIODICITIES,
  filedReturnsCatalogueEntries,
  supportedFiledReturnsCatalogueEntries,
} from "../../src/connectors/gst/filed-returns-capabilities";
import {
  FILED_RETURNS_RETURN_TYPES,
  isFiledReturnsReturnType,
} from "../../src/connectors/gst/filed-returns-return-types";
import { returnTypeOptions } from "../../src/entrypoints/popup/scope-form-model";

describe("filed-return catalogue", () => {
  it("declares one nine-row source with every axis shape", () => {
    const entries = filedReturnsCatalogueEntries();

    expect(entries).toHaveLength(9);
    expect(new Set(entries.map((entry) => entry.returnType)).size).toBe(9);
    expect(new Set(entries.map((entry) => entry.capability.periodicity))).toEqual(
      new Set(FILED_RETURNS_PERIODICITIES),
    );
  });

  it("keeps unsupported declarations out of runtime validation", () => {
    expect(FILED_RETURNS_RETURN_TYPES).toEqual(["GSTR-3B", "GSTR-1", "GSTR-2B"]);
    expect(supportedFiledReturnsCatalogueEntries().map((entry) => entry.returnType)).toEqual(
      FILED_RETURNS_RETURN_TYPES,
    );
    expect(isFiledReturnsReturnType("GSTR-9")).toBe(false);
    expect(isFiledReturnsReturnType("GSTR-4")).toBe(false);
    expect(isFiledReturnsReturnType("IFF")).toBe(false);
    expect(isFiledReturnsReturnType("LEDGERS")).toBe(false);
  });

  it("derives product controls only from supported rows", () => {
    const options = returnTypeOptions();

    expect(options.map((option) => option.value)).toEqual(FILED_RETURNS_RETURN_TYPES);
    expect(options.map((option) => option.periodicity)).toEqual(["monthly", "monthly", "monthly"]);
    expect(options.every((option) => option.label.length > 0)).toBe(true);
  });

  it("keeps artifact availability on each supported catalogue row", () => {
    const supported = supportedFiledReturnsCatalogueEntries();

    expect(Object.keys(supported[0]?.capability.artifacts ?? {})).toEqual(["PDF", "JSON"]);
    expect(Object.keys(supported[1]?.capability.artifacts ?? {})).toEqual(["PDF", "EXCEL"]);
    expect(Object.keys(supported[2]?.capability.artifacts ?? {})).toEqual(["PDF", "EXCEL", "JSON"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  flattenJsonTextScalarLeaves,
  JsonFlatTableLimitError,
  jsonNumberTokenToPlainDecimal,
} from "../../src/core/json-flat-table";

describe("flat JSON leaf extraction", () => {
  it("expands exponent numbers exactly without JavaScript rounding", () => {
    expect(jsonNumberTokenToPlainDecimal("2.038519331E7")).toBe("20385193.31");
    expect(jsonNumberTokenToPlainDecimal("99999999999999.999")).toBe("99999999999999.999");
    expect(jsonNumberTokenToPlainDecimal("0.10000000000000001")).toBe("0.10000000000000001");
    expect(jsonNumberTokenToPlainDecimal("1.2300e+3")).toBe("1230.0");
    expect(jsonNumberTokenToPlainDecimal("1e-3")).toBe("0.001");
  });

  it("keeps strings as text and arrays as numeric counts at JSON Pointer paths", () => {
    expect(
      flattenJsonTextScalarLeaves(
        '{"identifier":"00042","amount":2.038519331E7,"nested":{"a/b":true},"items":[1,2]}',
      ),
    ).toEqual([
      { path: "/identifier", valueKind: "text", value: "00042" },
      { path: "/amount", valueKind: "number", value: "20385193.31" },
      { path: "/nested/a~1b", valueKind: "text", value: "true" },
      { path: "/items", valueKind: "number", value: "2" },
    ]);
  });

  it("fails closed before expanding an unbounded numeric exponent", () => {
    expect(() => jsonNumberTokenToPlainDecimal("1e99999999", 1_024)).toThrow(
      JsonFlatTableLimitError,
    );
  });
});

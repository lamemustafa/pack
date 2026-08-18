import { describe, expect, it } from "vitest";
import { csvEmptyString, csvNumberText, toCsv } from "../../src/core/csv";

describe("CSV emission", () => {
  it("uses an explicit union header order and distinguishes null from a missing value", () => {
    expect(
      toCsv(
        [
          { beta: 2, alpha: "quoted, value" },
          { alpha: null, gamma: true, formula: " =SUM(1,2)" },
        ],
        ["alpha", "beta", "gamma", "formula"],
      ),
    ).toBe('alpha,beta,gamma,formula\n"quoted, value",2,,\nnull,,true,"\' =SUM(1,2)"\n');
  });

  it("emits validated plain-decimal numeric text without spreadsheet text coercion", () => {
    expect(
      toCsv(
        [
          { value_number: csvNumberText("20385193.31") },
          { value_number: csvNumberText("-0.0001") },
        ],
        ["value_number"],
      ),
    ).toBe("value_number\n20385193.31\n-0.0001\n");
    expect(() => csvNumberText("2.038519331E7")).toThrow("plain decimal notation");
  });

  it("distinguishes an explicit empty string from a missing cell", () => {
    expect(
      toCsv(
        [{ value_text: csvEmptyString(), value_number: undefined }],
        ["value_text", "value_number"],
      ),
    ).toBe('value_text,value_number\n"",\n');
  });
});

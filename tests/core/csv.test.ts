import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/core/csv";

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
});

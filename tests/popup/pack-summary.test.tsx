import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import { PackSummary } from "../../src/entrypoints/popup/pack-summary";

describe("pack summary", () => {
  it("uses the GSTR-2B availability floor when counting its first fiscal year", () => {
    const markup = renderToStaticMarkup(
      <PackSummary
        scope={{
          artifactType: "PDF",
          financialYear: "2020-21",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-2B",
        }}
        summary={null}
      />,
    );

    expect(markup).toContain("9 periods");
  });
});

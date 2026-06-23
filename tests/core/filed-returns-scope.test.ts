import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE,
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsPeriodOptions,
  isSupportedFiledReturnsScope,
  normaliseFiledReturnsScope,
} from "../../src/core/filed-returns-scope";

describe("filed returns GST scope", () => {
  it("lists financial years from current Indian FY back to GST launch year", () => {
    expect(getFiledReturnsFinancialYearOptions(new Date("2026-06-20T00:00:00+05:30"))).toEqual([
      "2026-27",
      "2025-26",
      "2024-25",
      "2023-24",
      "2022-23",
      "2021-22",
      "2020-21",
      "2019-20",
      "2018-19",
      "2017-18",
    ]);
  });

  it("starts FY 2017-18 at July because GST returns begin from July 2017", () => {
    expect(getFiledReturnsPeriodOptions("2017-18").map((option) => option.value)).toEqual([
      "ALL",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
      "January",
      "February",
      "March",
    ]);
  });

  it("normalises invalid early GST launch months instead of passing them to the portal", () => {
    expect(
      normaliseFiledReturnsScope({
        financialYear: "2017-18",
        period: "April",
        returnType: "GSTR-3B",
      }),
    ).toEqual({
      financialYear: "2017-18",
      period: "July",
      returnType: "GSTR-3B",
    });
  });

  it("defaults to a single completed Indian filing month instead of all periods", () => {
    expect(DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE).toMatchObject({
      period: expect.not.stringMatching(/^ALL$/),
      returnType: "GSTR-3B",
    });
  });

  it("uses India Standard Time around financial-year boundaries", () => {
    expect(getFiledReturnsFinancialYearOptions(new Date("2026-03-31T20:00:00.000Z"))[0]).toBe(
      "2026-27",
    );
  });

  it("rejects unsupported fiscal years and months", () => {
    expect(
      isSupportedFiledReturnsScope({
        financialYear: "2017-18",
        period: "July",
        returnType: "GSTR-3B",
      }),
    ).toBe(true);
    expect(
      isSupportedFiledReturnsScope({
        financialYear: "2017-18",
        period: "June",
        returnType: "GSTR-3B",
      }),
    ).toBe(false);
    expect(
      isSupportedFiledReturnsScope({
        financialYear: "2016-17",
        period: "ALL",
        returnType: "GSTR-3B",
      }),
    ).toBe(false);
  });
});

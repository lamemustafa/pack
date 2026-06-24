import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE,
  FULL_FISCAL_YEAR_PERIOD,
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsFullFiscalYearPeriods,
  getFiledReturnsPeriodOptions,
  getFiledReturnsScopePeriodOptions,
  isFullFiscalYearScope,
  isSupportedFiledReturnsScope,
  isSupportedFiledReturnsStartScope,
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

  it("exposes only elapsed periods for the current Indian financial year", () => {
    expect(
      getFiledReturnsPeriodOptions("2026-27", new Date("2026-06-24T00:00:00+05:30")).map(
        (option) => option.value,
      ),
    ).toEqual(["April", "May"]);
    expect(
      getFiledReturnsPeriodOptions("2025-26", new Date("2026-06-24T00:00:00+05:30")).map(
        (option) => option.value,
      ),
    ).toEqual([
      "April",
      "May",
      "June",
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
    expect(
      isSupportedFiledReturnsScope(
        {
          financialYear: "2026-27",
          period: "July",
          returnType: "GSTR-3B",
        },
        new Date("2026-06-24T00:00:00+05:30"),
      ),
    ).toBe(false);
  });

  it("plans full fiscal year targets from concrete eligible filing periods", () => {
    expect(
      getFiledReturnsFullFiscalYearPeriods("2017-18", new Date("2026-06-24T00:00:00+05:30")),
    ).toEqual([
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
    expect(
      getFiledReturnsFullFiscalYearPeriods("2026-27", new Date("2026-06-24T00:00:00+05:30")),
    ).toEqual(["April", "May"]);
  });

  it("exposes full fiscal year as a start-only user option without changing the default", () => {
    expect(
      getFiledReturnsScopePeriodOptions("2025-26", new Date("2026-06-24T00:00:00+05:30"))[0],
    ).toEqual({
      value: FULL_FISCAL_YEAR_PERIOD,
      label: "Full fiscal year",
    });
    expect(DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE.period).not.toBe(FULL_FISCAL_YEAR_PERIOD);
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

  it("normalises and validates full fiscal year only at the start boundary", () => {
    const scope = normaliseFiledReturnsScope(
      {
        financialYear: "2025-26",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      new Date("2026-06-24T00:00:00+05:30"),
    );

    expect(scope).toEqual({
      financialYear: "2025-26",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    });
    expect(isFullFiscalYearScope(scope)).toBe(true);
    expect(isSupportedFiledReturnsStartScope(scope, new Date("2026-06-24T00:00:00+05:30"))).toBe(
      true,
    );
    expect(isSupportedFiledReturnsScope(scope, new Date("2026-06-24T00:00:00+05:30"))).toBe(false);
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
      isSupportedFiledReturnsStartScope({
        financialYear: "2025-26",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      }),
    ).toBe(true);
    expect(
      isSupportedFiledReturnsScope({
        financialYear: "2016-17",
        period: "ALL",
        returnType: "GSTR-3B",
      }),
    ).toBe(false);
    expect(
      isSupportedFiledReturnsScope({
        financialYear: "2025-26",
        period: "ALL",
        returnType: "GSTR-3B",
      }),
    ).toBe(false);
  });
});

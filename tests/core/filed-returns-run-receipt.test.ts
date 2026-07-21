import { describe, expect, it } from "vitest";
import {
  createFullFiscalYearFiledReturnsReceipt,
  createSinglePeriodFiledReturnsReceipt,
  isFiledReturnsRunReceiptV1,
} from "../../src/core/filed-returns-run-receipt";

describe("filed returns archive receipt", () => {
  it("creates a non-identifying receipt for a selected-period ZIP", () => {
    const receipt = createSinglePeriodFiledReturnsReceipt(
      {
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
        artifactType: "PDF_AND_EXCEL",
      },
      new Date("2026-07-21T00:00:00.000Z"),
    );

    expect(receipt).toEqual({
      schemaVersion: "1.0",
      createdAt: "2026-07-21T00:00:00.000Z",
      archiveScope: "single-period",
      returnType: "GSTR-1",
      financialYear: "2025-26",
      artifactTypes: ["PDF", "EXCEL"],
      targetCount: 1,
      artifactCount: 2,
      targets: [
        {
          targetId: "GSTR-1:2025-26:May",
          period: "May",
          status: "prepared",
        },
      ],
    });
    expect(JSON.stringify(receipt)).not.toContain("forbidden-metadata");
    expect(isFiledReturnsRunReceiptV1(receipt)).toBe(true);
  });

  it("counts available artifacts and does not accept unknown receipt fields", () => {
    const receipt = createFullFiscalYearFiledReturnsReceipt(
      {
        schemaVersion: "1.0",
        ledgerId: "ledger-safe",
        status: "complete",
        scope: {
          financialYear: "2025-26",
          period: "FULL_FISCAL_YEAR",
          returnType: "GSTR-1",
          artifactType: "PDF_AND_EXCEL",
        },
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
        targets: [
          {
            targetId: "GSTR-1:2025-26:May",
            financialYear: "2025-26",
            period: "May",
            returnType: "GSTR-1",
            artifactType: "PDF_AND_EXCEL",
            status: "downloaded",
            attempts: 1,
            safeSignals: [
              "full-fiscal-year-opfs-staged:PDF",
              "filed-return-artifact-unavailable:EXCEL",
            ],
            safeMessage: "Prepared.",
            updatedAt: "2026-07-21T00:00:00.000Z",
          },
          {
            targetId: "GSTR-1:2025-26:June",
            financialYear: "2025-26",
            period: "June",
            returnType: "GSTR-1",
            artifactType: "PDF_AND_EXCEL",
            status: "not-filed",
            attempts: 1,
            safeSignals: [],
            safeMessage: "No filed record observed.",
            updatedAt: "2026-07-21T00:00:00.000Z",
          },
        ],
      },
      new Date("2026-07-21T00:00:00.000Z"),
    );

    expect(receipt.artifactCount).toBe(1);
    expect(receipt.targets.map((target) => target.status)).toEqual(["prepared", "not-filed"]);
    expect(isFiledReturnsRunReceiptV1({ ...receipt, unsafe: "forbidden-metadata" })).toBe(false);
    expect(
      isFiledReturnsRunReceiptV1({
        ...receipt,
        targets: [{ ...receipt.targets[0], targetId: "arbitrary-user-label" }, receipt.targets[1]],
      }),
    ).toBe(false);
  });
});

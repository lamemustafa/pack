import { describe, expect, it } from "vitest";
import { artifactAcquisitionCompletionFlowStep } from "../../src/background/filed-returns-artifact-acquisition-completion";

describe("artifact acquisition completion evidence", () => {
  it("does not turn component markers into an all-formats completion", () => {
    const flowStep = artifactAcquisitionCompletionFlowStep(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      },
      [
        {
          artifactType: "PDF",
          downloadId: 9,
          requestId: "00000000-0000-4000-8000-000000000001",
        },
        {
          artifactType: "EXCEL",
          downloadId: 10,
          requestId: "00000000-0000-4000-8000-000000000002",
        },
        {
          artifactType: "JSON",
          downloadId: 11,
          requestId: "00000000-0000-4000-8000-000000000003",
        },
      ],
    );

    expect(flowStep).toBeNull();
  });

  it("keeps exact single-artifact marker evidence as a completion", () => {
    expect(
      artifactAcquisitionCompletionFlowStep(
        {
          artifactType: "PDF",
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-3B",
        },
        [
          {
            artifactType: "PDF",
            downloadId: 9,
            requestId: "00000000-0000-4000-8000-000000000001",
          },
        ],
      ),
    ).toMatchObject({ state: "downloaded" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsTargetReview,
} from "../../src/connectors/gst/filed-returns-contracts";
import type * as FiledReturnsTargetReviewModule from "../../src/background/filed-returns-target-review";

const mocks = vi.hoisted(() => ({
  readCurrentFiledReturnsTargetReviewStorageState: vi.fn(),
  responseForFiledReturnsTargetReview: vi.fn(() => ({
    ok: true as const,
    flowStep: {
      connectorId: "gst" as const,
      scopeId: "gst-gstr2b-private-v0",
      state: "blocked" as const,
      safeSignals: ["retained-gstr2b-review"],
      safeMessage: "Synthetic retained review.",
    },
  })),
  startSinglePeriodFiledReturnsDownloadFlow: vi.fn(async (scope: FiledReturnsDownloadScope) => ({
    ok: true as const,
    flowStep: {
      connectorId: "gst" as const,
      scopeId: `started:${scope.returnType}:${scope.artifactType ?? "PDF"}`,
      state: "clicked" as const,
      safeSignals: ["new-target-started"],
      safeMessage: "Synthetic new target.",
    },
  })),
}));

vi.mock("../../src/background/filed-returns-target-review", async (importOriginal) => ({
  ...(await importOriginal<typeof FiledReturnsTargetReviewModule>()),
  readCurrentFiledReturnsTargetReviewStorageState:
    mocks.readCurrentFiledReturnsTargetReviewStorageState,
  responseForFiledReturnsTargetReview: mocks.responseForFiledReturnsTargetReview,
}));
vi.mock("../../src/background/filed-returns-single-period-flow", () => ({
  startSinglePeriodFiledReturnsDownloadFlow: mocks.startSinglePeriodFiledReturnsDownloadFlow,
}));

import { startFiledReturnsDownloadFlow } from "../../src/background/filed-returns-flow-runner";

const retainedScope = {
  artifactType: "PDF_AND_EXCEL",
  financialYear: "2026-27",
  period: "June",
  returnType: "GSTR-2B",
} as const satisfies FiledReturnsDownloadScope;

describe("filed returns retained target scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCurrentFiledReturnsTargetReviewStorageState.mockResolvedValue({
      state: "valid",
      review: { scope: retainedScope } as FiledReturnsTargetReview,
    });
  });

  it.each([
    ["GSTR-1 PDF", { artifactType: "PDF", returnType: "GSTR-1" }],
    ["GSTR-3B PDF", { artifactType: "PDF", returnType: "GSTR-3B" }],
    ["GSTR-2B JSON", { artifactType: "JSON", returnType: "GSTR-2B" }],
  ] as const)("does not let a retained GSTR-2B review shadow %s", async (_label, target) => {
    const scope = {
      ...target,
      financialYear: "2026-27",
      period: "June",
    } satisfies FiledReturnsDownloadScope;

    const response = await startFiledReturnsDownloadFlow(scope, {
      storageKeys: {},
    } as never);

    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).toHaveBeenCalledWith(
      scope,
      expect.anything(),
    );
    expect(response).toMatchObject({ flowStep: { safeSignals: ["new-target-started"] } });
  });

  it("keeps the retained review bound to its own GSTR-2B bundle target", async () => {
    const response = await startFiledReturnsDownloadFlow(retainedScope, {
      storageKeys: {},
    } as never);

    expect(mocks.responseForFiledReturnsTargetReview).toHaveBeenCalledOnce();
    expect(mocks.startSinglePeriodFiledReturnsDownloadFlow).not.toHaveBeenCalled();
    expect(response).toMatchObject({ flowStep: { safeSignals: ["retained-gstr2b-review"] } });
  });
});

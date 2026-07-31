import { describe, expect, it } from "vitest";
import {
  getGstr3bPortalReturnPeriodToken,
  isPotentialTargetBoundGstr3bPortalDownloadCandidate,
  isTargetBoundGstr3bPortalDownloadCandidate,
  MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS,
  targetBoundNativeFilenameNonceForActionId,
  type TargetBoundGstr3bPortalDownloadContext,
  type TargetBoundPortalDownloadItem,
} from "../../src/connectors/gst/filed-returns-target-bound-download-candidate";

const ARMED_AT = new Date("2026-04-20T10:00:00.000Z");
const ACTION_ID = "00000000-0000-4000-8000-000000000001";
const FILENAME_NONCE = "00000000000040008000000000000001";

describe("target-bound GSTR-3B portal download candidate", () => {
  it("accepts a portal-created PDF only when both blob URLs and the target period match", () => {
    expect(isTargetBoundGstr3bPortalDownloadCandidate(candidate(), context())).toBe(true);
  });

  it.each([undefined, "", "   ", "https://return.gst.gov.in/returns/auth/gstr3b"])(
    "accepts an empty or exact supported GST referrer",
    (referrer) => {
      expect(isTargetBoundGstr3bPortalDownloadCandidate(candidate({ referrer }), context())).toBe(
        true,
      );
    },
  );

  it.each([
    ["non-blob source", { url: "https://return.gst.gov.in/generated.pdf" }],
    ["non-blob final source", { finalUrl: "https://return.gst.gov.in/generated.pdf" }],
    ["lookalike blob source", { url: "blob:https://return.gst.gov.in.example/opaque" }],
    ["unsupported referrer", { referrer: "https://example.invalid/returns/auth/gstr3b" }],
    ["non-HTTPS GST referrer", { referrer: "http://return.gst.gov.in/returns/auth/gstr3b" }],
    ["blob referrer", { referrer: "blob:https://return.gst.gov.in/synthetic-referrer" }],
    ["missing source", { url: undefined }],
    ["missing final source", { finalUrl: undefined }],
  ] satisfies ReadonlyArray<readonly [string, Partial<TargetBoundPortalDownloadItem>]>)(
    "rejects %s",
    (_label, override) => {
      expect(isTargetBoundGstr3bPortalDownloadCandidate(candidate(override), context())).toBe(
        false,
      );
    },
  );

  it.each([
    ["wrong return", `GSTR1_042026_pack-${FILENAME_NONCE}.pdf`],
    ["wrong period", `GSTR3B_052026_pack-${FILENAME_NONCE}.pdf`],
    ["period embedded in digits", `GSTR3B_10420260_pack-${FILENAME_NONCE}.pdf`],
    ["wrong extension", `GSTR3B_042026_pack-${FILENAME_NONCE}.xlsx`],
    ["double extension", `GSTR3B_042026_pack-${FILENAME_NONCE}.pdf.zip`],
    ["missing action nonce", "GSTR3B_042026.pdf"],
    ["wrong action nonce", "GSTR3B_042026_pack-11111111111141118111111111111111.pdf"],
  ])("rejects a filename with %s", (_label, filename) => {
    expect(isTargetBoundGstr3bPortalDownloadCandidate(candidate({ filename }), context())).toBe(
      false,
    );
  });

  it("accepts the browser conflict suffix without weakening the action nonce", () => {
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ filename: `GSTR3B_042026_pack-${FILENAME_NONCE} (2).pdf` }),
        context(),
      ),
    ).toBe(true);
  });

  it("accepts only the strict native portal filename fallback for the selected period", () => {
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ filename: "GSTR3B_000000000000000_042026.pdf" }),
        context(),
      ),
    ).toBe(true);
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ filename: "GSTR3B_000000000000000_052026.pdf" }),
        context(),
      ),
    ).toBe(false);
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ filename: "GSTR3B_00000000000000_042026.pdf" }),
        context(),
      ),
    ).toBe(false);
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ filename: "gstr3b_000000000000000_042026.pdf" }),
        context(),
      ),
    ).toBe(false);
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ filename: "GSTR3B_00000000000000a_042026.pdf" }),
        context(),
      ),
    ).toBe(false);
  });

  it("derives the exact filename nonce only from canonical action IDs", () => {
    expect(targetBoundNativeFilenameNonceForActionId(ACTION_ID)).toBe(FILENAME_NONCE);
    expect(targetBoundNativeFilenameNonceForActionId("action-invalid")).toBeNull();
  });

  it("derives the portal month-year token across the fiscal-year boundary", () => {
    expect(getGstr3bPortalReturnPeriodToken(context().target)).toBe("042026");
    expect(getGstr3bPortalReturnPeriodToken({ financialYear: "2026-27", period: "January" })).toBe(
      "012027",
    );
    expect(
      getGstr3bPortalReturnPeriodToken({ financialYear: "2026-28", period: "April" }),
    ).toBeNull();
    expect(
      getGstr3bPortalReturnPeriodToken({
        financialYear: "2026-27",
        period: "FULL_FISCAL_YEAR",
      }),
    ).toBeNull();
  });

  it.each([
    ["missing MIME", { mime: undefined }],
    ["generic MIME", { mime: "application/octet-stream" }],
    ["interrupted state", { state: "interrupted" }],
    ["missing state", { state: undefined }],
    ["incognito mismatch", { incognito: true }],
    ["extension-created", { byExtensionId: "synthetic-extension-id" }],
    ["empty extension id", { byExtensionId: "" }],
    ["negative id", { id: -1 }],
  ] satisfies ReadonlyArray<readonly [string, Partial<TargetBoundPortalDownloadItem>]>)(
    "rejects %s",
    (_label, override) => {
      expect(isTargetBoundGstr3bPortalDownloadCandidate(candidate(override), context())).toBe(
        false,
      );
    },
  );

  it("accepts complete downloads and an exact matching incognito context", () => {
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ incognito: true, state: "complete" }),
        context({ expectedIncognito: true }),
      ),
    ).toBe(true);
  });

  it("allows mutable creation metadata to arrive during exact-ID refresh", () => {
    expect(
      isPotentialTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ filename: undefined, mime: undefined, state: undefined }),
        context(),
      ),
    ).toBe(true);
  });

  it("rejects a potential candidate with an incompatible immutable origin", () => {
    expect(
      isPotentialTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ url: "blob:https://example.invalid/synthetic" }),
        context(),
      ),
    ).toBe(false);
  });

  it("requires an exact GSTR-3B PDF target", () => {
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate(),
        context({ target: { ...context().target, artifactType: "EXCEL" } }),
      ),
    ).toBe(false);
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate(),
        context({ target: { ...context().target, returnType: "GSTR-1" } }),
      ),
    ).toBe(false);
  });

  it("accepts only starts within a valid bounded action window", () => {
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ startTime: new Date(ARMED_AT.getTime() - 1).toISOString() }),
        context(),
      ),
    ).toBe(false);
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate({ startTime: new Date(ARMED_AT.getTime() + 5_001).toISOString() }),
        context(),
      ),
    ).toBe(false);
    expect(
      isTargetBoundGstr3bPortalDownloadCandidate(
        candidate(),
        context({
          windowEndsAt: new Date(
            ARMED_AT.getTime() + MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS + 1,
          ),
        }),
      ),
    ).toBe(false);
  });
});

function candidate(
  override: Partial<TargetBoundPortalDownloadItem> = {},
): TargetBoundPortalDownloadItem {
  return {
    filename: `GSTR3B_042026_pack-${FILENAME_NONCE}.pdf`,
    finalUrl: "blob:https://return.gst.gov.in/synthetic-final-object",
    id: 7,
    incognito: false,
    mime: "application/pdf",
    referrer: "",
    startTime: new Date(ARMED_AT.getTime() + 500).toISOString(),
    state: "in_progress",
    url: "blob:https://return.gst.gov.in/synthetic-source-object",
    ...override,
  };
}

function context(
  override: Partial<TargetBoundGstr3bPortalDownloadContext> = {},
): TargetBoundGstr3bPortalDownloadContext {
  return {
    armedAt: ARMED_AT,
    expectedIncognito: false,
    filenameNonce: FILENAME_NONCE,
    target: {
      actionId: ACTION_ID,
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-3B",
    },
    windowEndsAt: new Date(ARMED_AT.getTime() + 5_000),
    ...override,
  };
}

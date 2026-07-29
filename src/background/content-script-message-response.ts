import type { PackMessageResponse } from "../connectors/gst/messages";

export type ContentScriptUnavailableReason = "empty-response" | "unreachable";

export function contentScriptUnavailableResponse(
  reason: ContentScriptUnavailableReason,
): Extract<PackMessageResponse, { ok: false }> {
  return {
    ok: false,
    error: "CONTENT_SCRIPT_UNAVAILABLE",
    safeMessage:
      reason === "empty-response"
        ? "The GST tab responded to Pack without a usable result. Reload the GST Portal tab, then try again."
        : "Pack could not safely reach the GST tab. Reload the GST Portal tab, then try again.",
  };
}

export function normaliseContentScriptMessageResponse(input: unknown): PackMessageResponse {
  if (!isRecord(input) || typeof input.ok !== "boolean") {
    return contentScriptUnavailableResponse("empty-response");
  }
  if (input.ok === false && typeof input.error !== "string") {
    return contentScriptUnavailableResponse("empty-response");
  }
  return input as PackMessageResponse;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

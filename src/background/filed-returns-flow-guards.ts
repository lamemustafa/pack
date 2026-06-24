import type { PackMessageResponse } from "../core/messages";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";

export function ambiguousDownloadTriggerResponse(): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "user-action-required",
      safeSignals: ["filed-gstr3b-download-trigger-ambiguous"],
      safeMessage:
        "Pack could not confirm whether the GST Portal received the download click, so it did not retry the side-effectful action. Check the browser downloads shelf, then retry only if no PDF appeared.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message:
          "Check whether the filed GSTR-3B PDF already downloaded. Retry from the GST Portal detail page only if no PDF appeared.",
        canResume: true,
      },
    },
  };
}

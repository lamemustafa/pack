import { browser } from "wxt/browser";
import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../core/contracts";
import {
  receiptForCompletedSinglePeriod,
  type FiledReturnsRunReceiptV1,
} from "../core/filed-returns-run-receipt";
import { safeSinglePeriodReceiptFilename } from "../connectors/gst/filed-returns-download-path";

export type SinglePeriodReceiptExportResult =
  { ok: true; receipt: FiledReturnsRunReceiptV1 } | { ok: false; error: string };

/**
 * This is an explicit user-requested local side effect. It never changes the
 * GST target result or retries a GST action; the existing completed summary is
 * the sole authority for whether a receipt can be exported.
 */
export async function exportCompletedSinglePeriodReceipt(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null,
): Promise<SinglePeriodReceiptExportResult> {
  const receipt = receiptForCompletedSinglePeriod(scope, summary);
  if (!receipt) {
    return {
      ok: false,
      error:
        "A local receipt is available only after Pack verifies this selected single-period download.",
    };
  }

  try {
    await browser.downloads.download({
      conflictAction: "uniquify",
      filename: safeSinglePeriodReceiptFilename(scope),
      saveAs: false,
      url: `data:application/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(receipt, null, 2),
      )}`,
    });
  } catch {
    return {
      ok: false,
      error: "Chrome could not start the optional local receipt download. Try again from Results.",
    };
  }

  return { ok: true, receipt };
}

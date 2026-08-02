import { browser } from "wxt/browser";
import {
  gstr3bPdfDiagnosticProbe,
  type Gstr3bPdfDiagnosticProbe,
} from "../connectors/gst/gstr3b-pdf-diagnostic-probe";
import { parseDurableFiledReturnsFlowSummary } from "./filed-returns-durable-summary";

/**
 * Reads only the current in-session summary. This intentionally does not use
 * canonical readers, which may repair malformed storage as a side effect.
 */
export async function readGstr3bPdfDiagnosticProbe(
  completionKey: string,
): Promise<Gstr3bPdfDiagnosticProbe> {
  try {
    const values = await browser.storage.session.get(completionKey);
    return gstr3bPdfDiagnosticProbe(parseDurableFiledReturnsFlowSummary(values[completionKey]));
  } catch {
    return gstr3bPdfDiagnosticProbe(null);
  }
}

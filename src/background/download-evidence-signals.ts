import { isUnconfirmedFiledReturnsDownloadSignal } from "../connectors/gst/filed-returns-durable-signals";

export function isUnconfirmedBrowserDownloadSignal(signal: string): boolean {
  return isUnconfirmedFiledReturnsDownloadSignal(signal);
}

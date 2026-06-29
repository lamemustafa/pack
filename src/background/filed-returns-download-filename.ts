import type { FiledReturnsDownloadScope } from "../core/contracts";

const SAFE_DOWNLOAD_ROOT = "complyeaze-pack/gst";

export function safeFiledReturnDownloadFilename(scope: FiledReturnsDownloadScope): string {
  return [
    SAFE_DOWNLOAD_ROOT,
    safeFilenameSegment(scope.financialYear),
    safeFilenameSegment(scope.returnType),
    `${safeFilenameSegment(scope.period)}.pdf`,
  ].join("/");
}

function safeFilenameSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

import type { FiledReturnsDownloadTarget } from "../core/contracts";

export function capturedDownloadSignalPrefix(target: FiledReturnsDownloadTarget): string {
  if (target.returnType === "GSTR-1") return "filed-gstr1";
  if (target.returnType === "GSTR-3B") return "filed-gstr3b";
  if (target.returnType === "GSTR-2B") return "gstr2b";
  return "filed-return";
}

import type { FiledReturnsFlowSummary } from "../../core/contracts";
import { receiptForCompletedSinglePeriod } from "../../core/filed-returns-run-receipt";

export function SinglePeriodReceipt({
  busy,
  downloadStatus,
  onDownload,
  summary,
}: {
  busy: boolean;
  downloadStatus: string | null;
  onDownload: () => void;
  summary: FiledReturnsFlowSummary | null;
}) {
  const receipt = summary ? receiptForCompletedSinglePeriod(summary.scope, summary) : null;
  if (!receipt) return null;

  return (
    <section className="evidence-panel" aria-label="Local run receipt">
      <div className="evidence-heading">
        <div>
          <p className="section-label">Local run receipt</p>
          <h2>Verified single-period download</h2>
        </div>
      </div>
      <p className="status-detail">
        {receipt.returnType} · FY {receipt.financialYear} · {receipt.targets[0]?.period} ·{" "}
        {receipt.artifactTypes.join(" + ")}
      </p>
      <p className="status-detail">
        This optional receipt contains only Pack-generated scope and verification status. It does
        not contain portal content, account information, original filenames, or local paths.
      </p>
      {downloadStatus ? <p className="status-detail" role="status">{downloadStatus}</p> : null}
      <button type="button" className="secondary" disabled={busy} onClick={onDownload}>
        {busy ? "Requesting local receipt..." : "Download receipt (.json)"}
      </button>
    </section>
  );
}

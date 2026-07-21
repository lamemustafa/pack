export function LocalProcessingAcknowledgement({
  busy,
  acknowledged,
  onAcknowledge,
}: {
  busy: boolean;
  acknowledged: boolean | null;
  onAcknowledge: () => void;
}) {
  if (acknowledged) return null;

  return (
    <section className="local-processing-acknowledgement" aria-labelledby="local-processing-title">
      <p className="local-processing-acknowledgement-kicker">Before the first live action</p>
      <h2 id="local-processing-title">Keep GST files local</h2>
      <p>
        Pack processes selected GST content locally. Temporary bytes may be staged in this browser
        for a selected-file batch or recovery; Pack does not send selected artifacts or extracted
        taxpayer identifiers to ComplyEaze servers in normal extension operation.
      </p>
      <p>
        Chrome saves downloads separately. Clearing Pack data does not remove downloads, browser
        history, backups, or sync copies.
      </p>
      <button type="button" disabled={busy || acknowledged === null} onClick={onAcknowledge}>
        {busy ? "Saving acknowledgement..." : "I understand — continue"}
      </button>
    </section>
  );
}

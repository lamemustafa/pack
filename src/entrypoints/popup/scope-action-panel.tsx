export function ScopeActionPanel({
  actionCopy,
  disabled,
  label,
  onStart,
}: {
  actionCopy: { summary: string; details: string[] };
  disabled: boolean;
  label: string;
  onStart: () => void;
}) {
  return (
    <div className="run-action-strip">
      <div className="run-action-main">
        <p className="section-label">Ready action</p>
        <p className="run-action-copy">{actionCopy.summary}</p>
      </div>
      <button className="primary-action" type="button" disabled={disabled} onClick={onStart}>
        {label}
      </button>
      {actionCopy.details.length > 0 ? (
        <details className="run-action-details">
          <summary>What Pack will do</summary>
          <ul aria-label="Download safeguards">
            {actionCopy.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

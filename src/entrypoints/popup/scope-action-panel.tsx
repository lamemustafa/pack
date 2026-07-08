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
      <div>
        <p className="section-label">Action</p>
        <p className="run-action-copy">{actionCopy.summary}</p>
        {actionCopy.details.length > 0 ? (
          <ul className="run-action-details" aria-label="Download safeguards">
            {actionCopy.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <button className="primary-action" type="button" disabled={disabled} onClick={onStart}>
        {label}
      </button>
    </div>
  );
}
